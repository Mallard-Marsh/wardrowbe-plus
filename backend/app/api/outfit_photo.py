import asyncio
import logging
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from PIL import Image, ImageOps
from pydantic import BaseModel
from sqlalchemy import select

from app.config import get_settings
from app.database import DbSession
from app.models.item import ClothingItem
from app.models.user import User
from app.services.ai_service import AIDisabledError, get_ai_service
from app.services.garment_detector import DetectedGarment
from app.services.image_service import ImageService
from app.services.outfit_photo_matcher import GarmentCandidates, parse_matches, shortlist
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user
from app.utils.signed_urls import sign_optional
from app.utils.uploads import UploadTooLargeError, read_upload_within_limit

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/outfits", tags=["Outfits"])

# The photo only has to show what is worn, so it is shrunk before it goes to the AI.
PHOTO_MAX_PX = 1600
# Each worn garment is cut out of the photo for the matching call, with some room round its box.
CROP_PADDING = 0.05
CROP_MAX_PX = 640


class PhotoBox(BaseModel):
    left: float
    top: float
    width: float
    height: float


class PhotoCandidate(BaseModel):
    item_id: UUID
    name: str | None = None
    type: str
    thumbnail_url: str | None = None


class PhotoMatch(BaseModel):
    item_id: UUID
    confidence: float


class PhotoGarment(BaseModel):
    type: str
    colors: list[str]
    box: PhotoBox
    match: PhotoMatch | None = None
    candidates: list[PhotoCandidate]


class OutfitPhotoResponse(BaseModel):
    garments: list[PhotoGarment]


def _normalise_photo(content: bytes) -> bytes:
    """Decode, rotate upright and shrink the photo; raises ValueError for anything unreadable."""
    try:
        image = ImageService()._open_bounded(content, ".jpg")
        image = ImageOps.exif_transpose(image).convert("RGB")
    except Exception as e:
        raise ValueError("Invalid image file") from e
    image.thumbnail((PHOTO_MAX_PX, PHOTO_MAX_PX), Image.Resampling.LANCZOS)
    out = BytesIO()
    image.save(out, format="JPEG", quality=88)
    return out.getvalue()


@router.post("/from-photo", response_model=OutfitPhotoResponse)
async def match_outfit_from_photo(
    db: DbSession,
    current_user: Annotated[User, Depends(get_current_user)],
    image: UploadFile = File(...),
) -> OutfitPhotoResponse:
    """Find the garments in a photo of the user and match each to an item in their wardrobe.

    Writes nothing and keeps nothing: the photo lives in a temporary file for the length of the
    request. The client has already cropped the person's face out before uploading.
    """
    await rate_limit_by_user(
        current_user.id, "outfit-from-photo", max_requests=10, window_seconds=60
    )
    try:
        ai = get_ai_service()
    except AIDisabledError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI vision is disabled"
        ) from e

    try:
        content = await read_upload_within_limit(image, settings.max_upload_size_mb)
    except UploadTooLargeError as e:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=str(e)) from None
    try:
        photo = await asyncio.to_thread(_normalise_photo, content)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    with tempfile.TemporaryDirectory() as scratch:
        photo_path = Path(scratch) / "photo.jpg"
        photo_path.write_bytes(photo)
        try:
            detected = await ai.detect_garments(photo_path)
        except Exception as e:
            logger.error(f"Garment detection failed for an outfit photo: {e}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="The AI service could not be reached",
            ) from e
        if not detected:
            return OutfitPhotoResponse(garments=[])

        rows = (
            await db.execute(
                select(ClothingItem).where(
                    ClothingItem.user_id == current_user.id, ClothingItem.is_archived.is_(False)
                )
            )
        ).scalars()
        items = list(rows)

        groups = shortlist([(g.type, g.colors) for g in detected], items)
        matches = await _match(ai, photo_path, detected, groups)

    return OutfitPhotoResponse(
        garments=[
            PhotoGarment(
                type=garment.type,
                colors=garment.colors,
                box=PhotoBox(
                    left=garment.left, top=garment.top, width=garment.width, height=garment.height
                ),
                match=(
                    PhotoMatch(item_id=match.item_id, confidence=match.confidence)
                    if match.item_id is not None
                    else None
                ),
                candidates=[
                    PhotoCandidate(
                        item_id=c.item.id,
                        name=c.item.name,
                        type=c.item.type,
                        thumbnail_url=sign_optional(c.item.thumbnail_path or c.item.image_path),
                    )
                    for c in group.candidates
                ],
            )
            for garment, group, match in zip(detected, groups, matches, strict=True)
        ]
    )


def _crop_garments(photo_path: Path, detected: list[DetectedGarment]) -> list[bytes]:
    """A JPEG close-up of each detected garment, cut from the photo with a little room round it."""
    crops = []
    with Image.open(photo_path) as photo:
        width, height = photo.size
        for g in detected:
            pad_x, pad_y = g.width * CROP_PADDING, g.height * CROP_PADDING
            box = (
                max(int((g.left - pad_x) * width), 0),
                max(int((g.top - pad_y) * height), 0),
                min(int((g.left + g.width + pad_x) * width) + 1, width),
                min(int((g.top + g.height + pad_y) * height) + 1, height),
            )
            crop = photo.crop(box)
            crop.thumbnail((CROP_MAX_PX, CROP_MAX_PX), Image.Resampling.LANCZOS)
            out = BytesIO()
            crop.convert("RGB").save(out, format="JPEG", quality=85)
            crops.append(out.getvalue())
    return crops


async def _match(
    ai, photo_path: Path, detected: list[DetectedGarment], groups: list[GarmentCandidates]
):
    """The model's pick per garment; no pick for any of them when there is nothing to choose from
    or the model cannot be reached (the person can still choose by hand)."""
    candidates = [c for group in groups for c in group.candidates]
    nothing = parse_matches("", groups)
    if not candidates:
        return nothing

    image_service = ImageService()
    # A candidate whose photo file is missing cannot be shown to the model, so it is left out.
    shown = [
        (
            c.number,
            group.garment_index + 1,
            image_service.get_image_path(c.item.thumbnail_path or c.item.image_path),
        )
        for group in groups
        for c in group.candidates
    ]
    shown = [entry for entry in shown if entry[2].exists()]
    if not shown:
        return nothing
    try:
        crops = await asyncio.to_thread(_crop_garments, photo_path, detected)
        reply = await ai.match_outfit_photo(
            [(i + 1, g.type, g.colors, crops[i]) for i, g in enumerate(detected)],
            shown,
        )
    except Exception as e:
        logger.error(f"Outfit photo matching failed: {e}")
        return nothing
    return parse_matches(reply, groups)
