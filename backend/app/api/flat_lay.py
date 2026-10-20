import logging
from typing import Annotated
from uuid import UUID

from arq import create_pool
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import DbSession
from app.models.outfit import Outfit, OutfitItem
from app.models.user import User
from app.services.image_service import ImageService
from app.utils.auth import get_current_user
from app.workers.queues import IMAGE_QUEUE
from app.workers.settings import get_redis_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/outfits", tags=["Outfits"])


class CutoutsPrepared(BaseModel):
    ready: int
    queued: int
    item_ids: list[UUID]


@router.post("/{outfit_id}/flat-lay/cutouts", response_model=CutoutsPrepared)
async def prepare_flat_lay_cutouts(
    outfit_id: UUID,
    db: DbSession,
    current_user: Annotated[User, Depends(get_current_user)],
) -> CutoutsPrepared:
    """Queue a transparent cut-out for each item of the outfit that does not have one yet.

    Idempotent: the job id is per item, so asking again while a cut-out is being made does not
    queue a second one. The client polls the outfit until every item has a cutout_url.
    """
    result = await db.execute(
        select(Outfit)
        .where(Outfit.id == outfit_id, Outfit.user_id == current_user.id)
        .options(selectinload(Outfit.items).selectinload(OutfitItem.item))
    )
    outfit = result.scalar_one_or_none()
    if outfit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outfit not found")

    image_service = ImageService()
    todo = []
    ready = 0
    for outfit_item in outfit.items:
        item = outfit_item.item
        if item is None or not item.image_path:
            continue
        if item.user_id != current_user.id:
            continue
        if image_service.existing_cutout(item.image_path):
            ready += 1
        else:
            todo.append(item)

    if not todo:
        return CutoutsPrepared(ready=ready, queued=0, item_ids=[])

    try:
        redis = await create_pool(get_redis_settings())
    except Exception as e:
        logger.error(f"Failed to connect to Redis for flat-lay cut-outs: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image worker unavailable",
        ) from e

    try:
        for item in todo:
            await redis.enqueue_job(
                "create_item_cutout_job",
                str(item.id),
                _queue_name=IMAGE_QUEUE,
                _job_id=f"cutout-{item.id}",
            )
    finally:
        await redis.close()

    return CutoutsPrepared(ready=ready, queued=len(todo), item_ids=[i.id for i in todo])
