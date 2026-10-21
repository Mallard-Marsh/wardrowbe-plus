"""Transparent cut-outs for flat-lay outfit pictures: creation, upkeep, worker job, endpoint."""

from datetime import date
from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import numpy as np
import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemStatus
from app.models.outfit import Outfit, OutfitItem, OutfitSource, OutfitStatus
from app.services.image_service import ImageService
from app.workers.background_removal import create_item_cutout_job

SIZE = (400, 600)


def _jpeg_bytes() -> bytes:
    buf = BytesIO()
    Image.new("RGB", SIZE, (10, 200, 30)).save(buf, format="JPEG")
    return buf.getvalue()


def _garment_on_transparent(box=(100, 150, 300, 450)) -> Image.Image:
    """What the background model returns: a coloured garment on a fully transparent canvas."""
    image = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    image.paste(Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (200, 30, 30, 255)), box[:2])
    return image


def _garment_with_stray_blob() -> Image.Image:
    """The garment plus a small distant blob, as when another item's edge is in the photo."""
    image = _garment_on_transparent()
    image.paste(Image.new("RGBA", (20, 20), (0, 200, 200, 255)), (350, 550))
    return image


def _pair_of_shoes() -> Image.Image:
    """Two similar-sized blobs, as a pair of shoes is."""
    image = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    image.paste(Image.new("RGBA", (80, 120), (200, 30, 30, 255)), (100, 200))
    image.paste(Image.new("RGBA", (80, 120), (200, 30, 30, 255)), (200, 200))
    return image


def _garment_with_holes() -> Image.Image:
    """The garment with a pin-hole and a real gap, as the gap between trouser legs is."""
    image = _garment_on_transparent()
    image.paste(Image.new("RGBA", (4, 4), (0, 0, 0, 0)), (200, 300))
    image.paste(Image.new("RGBA", (60, 60), (0, 0, 0, 0)), (220, 200))
    return image


def _garment_with_white_halo() -> Image.Image:
    """The garment with the 1px white fringe the background model often leaves."""
    image = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    halo = Image.new("RGBA", (202, 302), (255, 255, 255, 255))
    halo.paste(Image.new("RGBA", (200, 300), (200, 30, 30, 255)), (1, 1))
    image.paste(halo, (99, 149))
    return image


def _provider(result: Image.Image):
    provider = MagicMock()
    provider.remove.side_effect = lambda img: result.copy()
    return provider


async def _make_item(db_session: AsyncSession, user, **overrides) -> ClothingItem:
    paths = await ImageService().process_and_store(
        user_id=user.id, image_data=_jpeg_bytes(), original_filename="test.jpg"
    )
    item = ClothingItem(
        user_id=user.id,
        type=overrides.pop("type", "shirt"),
        image_path=paths["image_path"],
        medium_path=paths["medium_path"],
        thumbnail_path=paths["thumbnail_path"],
        image_hash=paths["image_hash"],
        status=ItemStatus.ready,
        **overrides,
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(item)
    return item


def _photo_path(service: ImageService) -> str:
    """A photo path whose folder exists, as it does for every stored item."""
    (service.storage_path / "cutouts").mkdir(parents=True, exist_ok=True)
    return f"cutouts/{uuid4()}.jpg"


class TestSaveCutout:
    def test_trims_to_the_garment_with_a_little_padding(self):
        service = ImageService()
        path = service.save_cutout(_garment_on_transparent(), _photo_path(service))

        with Image.open(service.storage_path / path) as saved:
            assert saved.mode == "RGBA"
            # 200x300 garment plus 2% of the long side (6px) on every edge. The clean-up's
            # 1px edge erosion trims one pixel off each side, hence 210x310, not 212x312.
            assert saved.size == (210, 310)
            assert saved.getpixel((0, 0))[3] == 0
            assert saved.getpixel((106, 156))[3] == 255

    def test_writes_a_png_beside_the_photo_and_leaves_no_partial_file(self):
        service = ImageService()
        image_path = _photo_path(service)

        path = service.save_cutout(_garment_on_transparent(), image_path)

        assert path == image_path.replace(".jpg", "_cutout.png")
        assert list((service.storage_path / "cutouts").glob("*.partial")) == []

    def test_large_cutouts_are_scaled_down(self):
        service = ImageService()
        big = Image.new("RGBA", (3000, 2000), (0, 0, 0, 0))
        big.paste(Image.new("RGBA", (2400, 1600), (1, 2, 3, 255)), (300, 200))

        path = service.save_cutout(big, _photo_path(service))

        with Image.open(service.storage_path / path) as saved:
            assert max(saved.size) <= 1000

    def test_an_empty_result_is_rejected(self):
        with pytest.raises(ValueError, match="No garment"):
            ImageService().save_cutout(Image.new("RGBA", SIZE, (0, 0, 0, 0)), "x/empty.jpg")

    def test_a_speck_is_rejected(self):
        speck = _garment_on_transparent((10, 10, 20, 20))
        with pytest.raises(ValueError, match="No garment"):
            ImageService().save_cutout(speck, "x/speck.jpg")

    def test_faint_halo_pixels_do_not_count_as_garment(self):
        halo = Image.new("RGBA", SIZE, (255, 255, 255, 5))
        with pytest.raises(ValueError, match="No garment"):
            ImageService().save_cutout(halo, "x/halo.jpg")

    def test_a_stray_blob_far_from_the_garment_is_removed(self):
        service = ImageService()
        path = service.save_cutout(_garment_with_stray_blob(), _photo_path(service))

        with Image.open(service.storage_path / path) as saved:
            # The blob is outside the garment, so the saved PNG is just the garment.
            assert saved.size == (210, 310)

    def test_two_similar_blobs_are_both_kept(self):
        service = ImageService()
        path = service.save_cutout(_pair_of_shoes(), _photo_path(service))

        with Image.open(service.storage_path / path) as saved:
            alpha = saved.getchannel("A")
            assert alpha.getpixel((44, 64)) == 255  # the left shoe
            assert alpha.getpixel((144, 64)) == 255  # the right shoe

    def test_small_holes_are_filled_but_large_ones_are_not(self):
        service = ImageService()
        path = service.save_cutout(_garment_with_holes(), _photo_path(service))

        with Image.open(service.storage_path / path) as saved:
            alpha = saved.getchannel("A")
            assert alpha.getpixel((108, 158)) == 255  # the pin-hole is filled
            assert alpha.getpixel((156, 86)) == 0  # the large hole stays open

    def test_a_one_pixel_white_halo_is_removed(self):
        service = ImageService()
        path = service.save_cutout(_garment_with_white_halo(), _photo_path(service))

        with Image.open(service.storage_path / path) as saved:
            # The halo is gone: the saved PNG is exactly the garment (with the halo it
            # would be 214x314, the halo's edge, not the garment's).
            assert saved.size == (212, 312)
            rgba = saved.convert("RGBA")
            background = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
            composited = Image.alpha_composite(background, rgba)
            alpha = np.asarray(rgba.getchannel("A"))
            edge = (alpha > 0) & (alpha < 255)
            assert edge.any()  # the cut edge is soft, not hard
            # Composited on black, the soft edge must not be brighter than the garment colour.
            for channel, garment in zip(composited.split(), (200, 30, 30), strict=False):
                assert (np.asarray(channel)[edge] <= garment).all()

    def test_missing_scipy_skips_the_clean_up(self):
        service = ImageService()
        with patch.dict("sys.modules", {"scipy": None}):
            path = service.save_cutout(_garment_on_transparent(), _photo_path(service))

        with Image.open(service.storage_path / path) as saved:
            assert saved.size == (212, 312)
            assert saved.getpixel((106, 156))[3] == 255


class TestCutoutLifecycle:
    @pytest.mark.asyncio
    async def test_remove_background_keeps_the_transparent_result(
        self, db_session: AsyncSession, test_user
    ):
        item = await _make_item(db_session, test_user)
        service = ImageService()

        with patch(
            "app.services.background_removal.get_provider",
            return_value=_provider(_garment_on_transparent()),
        ):
            service.remove_background(item.image_path)

        assert service.existing_cutout(item.image_path) is not None

    @pytest.mark.asyncio
    async def test_a_failing_cutout_does_not_fail_the_removal(
        self, db_session: AsyncSession, test_user
    ):
        item = await _make_item(db_session, test_user)
        service = ImageService()

        # Nothing found: the removal still produces its flattened photo.
        with patch(
            "app.services.background_removal.get_provider",
            return_value=_provider(Image.new("RGBA", SIZE, (0, 0, 0, 0))),
        ):
            paths = service.remove_background(item.image_path)

        assert paths["original_backup_path"]
        assert service.existing_cutout(item.image_path) is None

    @pytest.mark.asyncio
    async def test_create_cutout_cuts_the_stored_photo(self, db_session: AsyncSession, test_user):
        item = await _make_item(db_session, test_user)
        service = ImageService()

        with patch(
            "app.services.background_removal.get_provider",
            return_value=_provider(_garment_on_transparent()),
        ):
            path = service.create_cutout(item.image_path)

        assert service.existing_cutout(item.image_path) == path

    def test_create_cutout_for_a_missing_photo_raises(self):
        with pytest.raises(ValueError, match="not found"):
            ImageService().create_cutout("nowhere/missing.jpg")

    @pytest.mark.asyncio
    async def test_delete_images_removes_the_cutout(self, db_session: AsyncSession, test_user):
        item = await _make_item(db_session, test_user)
        service = ImageService()
        service.save_cutout(_garment_on_transparent(), item.image_path)
        assert service.existing_cutout(item.image_path)

        service.delete_images(
            {
                "image_path": item.image_path,
                "medium_path": item.medium_path,
                "thumbnail_path": item.thumbnail_path,
            }
        )

        assert service.existing_cutout(item.image_path) is None

    @pytest.mark.asyncio
    async def test_rotate_turns_the_cutout_too(self, db_session: AsyncSession, test_user):
        item = await _make_item(db_session, test_user)
        service = ImageService()
        path = service.save_cutout(_garment_on_transparent(), item.image_path)
        with Image.open(service.storage_path / path) as before:
            width, height = before.size

        service.rotate_image(item.image_path, 90)

        with Image.open(service.storage_path / path) as after:
            assert after.size == (height, width)


class TestCreateItemCutoutJob:
    @staticmethod
    async def _run(db_session, item_id, *, provider=None, release_enabled=False):
        settings = MagicMock(bg_removal_release_model=release_enabled)
        with (
            patch("app.workers.background_removal.get_db_session", return_value=db_session),
            patch.object(db_session, "close", new_callable=AsyncMock),
            patch("app.workers.background_removal.get_settings", return_value=settings),
            patch(
                "app.services.background_removal.get_provider",
                return_value=provider or _provider(_garment_on_transparent()),
            ),
            patch("app.workers.background_removal.background_removal.release") as release,
        ):
            result = await create_item_cutout_job({}, str(item_id))
        return result, release

    @pytest.mark.asyncio
    async def test_makes_the_cutout_and_leaves_the_item_alone(
        self, db_session: AsyncSession, test_user
    ):
        item = await _make_item(db_session, test_user)
        before = (item.status, item.image_path, item.original_image_path)

        result, _ = await self._run(db_session, item.id)

        assert result["status"] == "success"
        assert ImageService().existing_cutout(item.image_path)
        await db_session.refresh(item)
        assert (item.status, item.image_path, item.original_image_path) == before

    @pytest.mark.asyncio
    async def test_skips_work_when_a_cutout_exists(self, db_session: AsyncSession, test_user):
        item = await _make_item(db_session, test_user)
        ImageService().save_cutout(_garment_on_transparent(), item.image_path)
        provider = _provider(_garment_on_transparent())

        result, _ = await self._run(db_session, item.id, provider=provider)

        assert result["status"] == "exists"
        provider.remove.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_failure_is_reported_not_raised(self, db_session: AsyncSession, test_user):
        item = await _make_item(db_session, test_user)

        result, _ = await self._run(
            db_session, item.id, provider=_provider(Image.new("RGBA", SIZE, (0, 0, 0, 0)))
        )

        assert result["status"] == "error"
        await db_session.refresh(item)
        assert item.status == ItemStatus.ready

    @pytest.mark.asyncio
    async def test_missing_item(self, db_session: AsyncSession):
        result, _ = await self._run(db_session, uuid4())

        assert result["status"] == "error"

    @pytest.mark.asyncio
    async def test_releases_the_model_when_enabled(self, db_session: AsyncSession, test_user):
        item = await _make_item(db_session, test_user)

        _, release = await self._run(db_session, item.id, release_enabled=True)

        release.assert_called_once()


async def _make_outfit(db_session: AsyncSession, user, items) -> Outfit:
    outfit = Outfit(
        user_id=user.id,
        occasion="casual",
        scheduled_for=date.today(),
        status=OutfitStatus.pending,
        source=OutfitSource.manual,
    )
    for i, item in enumerate(items):
        outfit.items.append(OutfitItem(item_id=item.id, position=i))
    db_session.add(outfit)
    await db_session.commit()
    await db_session.refresh(outfit)
    return outfit


class TestOutfitResponseCutouts:
    @pytest.mark.asyncio
    async def test_items_carry_a_cutout_url_only_when_one_exists(
        self, client: AsyncClient, db_session: AsyncSession, test_user, auth_headers
    ):
        with_cutout = await _make_item(db_session, test_user, type="shirt")
        without = await _make_item(db_session, test_user, type="pants")
        ImageService().save_cutout(_garment_on_transparent(), with_cutout.image_path)
        outfit = await _make_outfit(db_session, test_user, [with_cutout, without])

        response = await client.get(f"/api/v1/outfits/{outfit.id}", headers=auth_headers)

        assert response.status_code == 200
        by_id = {i["id"]: i for i in response.json()["items"]}
        assert by_id[str(with_cutout.id)]["cutout_url"]
        assert by_id[str(without.id)]["cutout_url"] is None


class TestPrepareCutoutsEndpoint:
    @staticmethod
    def _redis():
        redis = MagicMock()
        redis.enqueue_job = AsyncMock()
        redis.close = AsyncMock()
        return redis

    @pytest.mark.asyncio
    async def test_queues_one_job_per_item_without_a_cutout(
        self, client: AsyncClient, db_session: AsyncSession, test_user, auth_headers
    ):
        done = await _make_item(db_session, test_user)
        todo = await _make_item(db_session, test_user, type="pants")
        ImageService().save_cutout(_garment_on_transparent(), done.image_path)
        outfit = await _make_outfit(db_session, test_user, [done, todo])
        redis = self._redis()

        with patch("app.api.flat_lay.create_pool", AsyncMock(return_value=redis)):
            response = await client.post(
                f"/api/v1/outfits/{outfit.id}/flat-lay/cutouts", headers=auth_headers
            )

        assert response.status_code == 200
        assert response.json() == {"ready": 1, "queued": 1, "item_ids": [str(todo.id)]}
        redis.enqueue_job.assert_awaited_once()
        args, kwargs = redis.enqueue_job.call_args
        assert args == ("create_item_cutout_job", str(todo.id))
        assert kwargs["_queue_name"] == "arq:images"
        assert kwargs["_job_id"] == f"cutout-{todo.id}"

    @pytest.mark.asyncio
    async def test_does_not_touch_redis_when_everything_is_ready(
        self, client: AsyncClient, db_session: AsyncSession, test_user, auth_headers
    ):
        item = await _make_item(db_session, test_user)
        ImageService().save_cutout(_garment_on_transparent(), item.image_path)
        outfit = await _make_outfit(db_session, test_user, [item])

        with patch("app.api.flat_lay.create_pool", AsyncMock(side_effect=AssertionError)):
            response = await client.post(
                f"/api/v1/outfits/{outfit.id}/flat-lay/cutouts", headers=auth_headers
            )

        assert response.json() == {"ready": 1, "queued": 0, "item_ids": []}

    @pytest.mark.asyncio
    async def test_unknown_outfit_is_404(self, client: AsyncClient, auth_headers):
        response = await client.post(
            f"/api/v1/outfits/{uuid4()}/flat-lay/cutouts", headers=auth_headers
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_redis_down_is_503(
        self, client: AsyncClient, db_session: AsyncSession, test_user, auth_headers
    ):
        item = await _make_item(db_session, test_user)
        outfit = await _make_outfit(db_session, test_user, [item])

        with patch("app.api.flat_lay.create_pool", AsyncMock(side_effect=ConnectionError)):
            response = await client.post(
                f"/api/v1/outfits/{outfit.id}/flat-lay/cutouts", headers=auth_headers
            )

        assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_requires_auth(self, client: AsyncClient):
        response = await client.post(f"/api/v1/outfits/{uuid4()}/flat-lay/cutouts")

        assert response.status_code in (401, 403)
