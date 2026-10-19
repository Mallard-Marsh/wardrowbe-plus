from contextlib import contextmanager
from io import BytesIO
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemStatus
from app.models.user import User
from app.schemas.item import RemoveBackgroundRequest
from app.services.image_service import ImageService
from app.workers.queues import IMAGE_QUEUE


def _jpeg_bytes(size: tuple[int, int] = (400, 600)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", size, (10, 200, 30)).save(buf, format="JPEG")
    return buf.getvalue()


async def _make_item(db_session: AsyncSession, user: User, **overrides) -> ClothingItem:
    svc = ImageService()
    paths = await svc.process_and_store(
        user_id=user.id, image_data=_jpeg_bytes(), original_filename="test.jpg"
    )
    defaults = {
        "user_id": user.id,
        "type": "shirt",
        "image_path": paths["image_path"],
        "medium_path": paths["medium_path"],
        "thumbnail_path": paths["thumbnail_path"],
        "image_hash": paths["image_hash"],
        "status": ItemStatus.ready,
    }
    defaults.update(overrides)
    item = ClothingItem(**defaults)
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(item)
    return item


@contextmanager
def _fake_queue():
    """Stand in for the Redis job queue so no real job is enqueued."""
    with patch("app.api.items.create_pool", new_callable=AsyncMock) as create_pool:
        redis = AsyncMock()
        redis.enqueue_job.return_value.job_id = "fake-job-id"
        create_pool.return_value = redis
        yield redis


class TestRemoveBackgroundRequest:
    def test_default_white(self):
        req = RemoveBackgroundRequest()
        assert req.bg_color == "#FFFFFF"

    def test_valid_hex(self):
        req = RemoveBackgroundRequest(bg_color="#FF0000")
        assert req.bg_color == "#FF0000"

    def test_lowercase_hex(self):
        req = RemoveBackgroundRequest(bg_color="#aabbcc")
        assert req.bg_color == "#aabbcc"

    def test_rejects_short_hex(self):
        with pytest.raises(ValidationError):
            RemoveBackgroundRequest(bg_color="#FFF")

    def test_rejects_no_hash(self):
        with pytest.raises(ValidationError):
            RemoveBackgroundRequest(bg_color="FFFFFF")

    def test_rejects_invalid_chars(self):
        with pytest.raises(ValidationError):
            RemoveBackgroundRequest(bg_color="#GGGGGG")


class TestRemoveBackgroundEndpoint:
    @pytest.mark.asyncio
    async def test_item_not_found(self, client: AsyncClient, test_user, auth_headers):
        response = await client.post(
            f"/api/v1/items/{uuid4()}/remove-background",
            json={},
            headers=auth_headers,
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_item_no_image(
        self, client: AsyncClient, test_user, auth_headers, db_session: AsyncSession
    ):
        item = ClothingItem(
            user_id=test_user.id,
            type="shirt",
            image_path="",
            status=ItemStatus.ready,
        )
        db_session.add(item)
        await db_session.commit()
        await db_session.refresh(item)

        response = await client.post(
            f"/api/v1/items/{item.id}/remove-background",
            json={},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "no image" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_unauthenticated(self, client: AsyncClient):
        response = await client.post(
            f"/api/v1/items/{uuid4()}/remove-background",
            json={},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_409_when_live_job_owns_the_item(
        self, client: AsyncClient, test_user, auth_headers, db_session: AsyncSession
    ):
        # A queued or running background-removal (or tagging) job owns
        # image_path/medium_path/thumbnail_path - racing it here would stomp
        # whichever write lands last.
        item = await _make_item(
            db_session,
            test_user,
            status=ItemStatus.processing,
            ai_job_id="live-job-id",
        )

        with _fake_queue() as redis:
            response = await client.post(
                f"/api/v1/items/{item.id}/remove-background",
                json={},
                headers=auth_headers,
            )
        assert response.status_code == 409
        redis.enqueue_job.assert_not_called()

    @pytest.mark.asyncio
    async def test_orphaned_processing_item_not_blocked(
        self, client: AsyncClient, test_user, auth_headers, db_session: AsyncSession
    ):
        # processing with no ai_job_id means no live job actually owns the
        # files (a prior enqueue silently failed) - must not be blocked.
        item = await _make_item(
            db_session,
            test_user,
            status=ItemStatus.processing,
            ai_job_id=None,
        )

        with _fake_queue():
            response = await client.post(
                f"/api/v1/items/{item.id}/remove-background",
                json={},
                headers=auth_headers,
            )
        assert response.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("status", "kind"),
        [
            (ItemStatus.ready, None),
            (ItemStatus.error, "background_removal"),
        ],
    )
    async def test_queues_the_job_on_the_image_queue(
        self,
        client: AsyncClient,
        test_user,
        auth_headers,
        db_session: AsyncSession,
        status,
        kind,
    ):
        # The removal runs on the image worker, not in the API process, so the
        # endpoint only marks the item processing and enqueues the job.
        item = await _make_item(db_session, test_user, status=status, processing_kind=kind)
        item_id = item.id

        with _fake_queue() as redis:
            response = await client.post(
                f"/api/v1/items/{item_id}/remove-background",
                json={"bg_color": "#112233"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["status"] == "processing"
        redis.enqueue_job.assert_awaited_once_with(
            "remove_item_background_job", str(item_id), "#112233", _queue_name=IMAGE_QUEUE
        )

        db_session.expire_all()
        result = await db_session.execute(select(ClothingItem).where(ClothingItem.id == item_id))
        refreshed = result.scalar_one()
        assert refreshed.status == ItemStatus.processing
        assert refreshed.processing_kind == "background_removal"
        assert refreshed.ai_started_at is None
        assert refreshed.ai_job_id == "fake-job-id"

    @pytest.mark.asyncio
    async def test_does_not_run_the_model_in_the_api_process(
        self, client: AsyncClient, test_user, auth_headers, db_session: AsyncSession
    ):
        item = await _make_item(db_session, test_user, status=ItemStatus.ready)

        with (
            _fake_queue(),
            patch("app.services.background_removal.get_provider") as get_provider,
        ):
            await client.post(
                f"/api/v1/items/{item.id}/remove-background",
                json={},
                headers=auth_headers,
            )

        get_provider.assert_not_called()

    @pytest.mark.asyncio
    async def test_failed_enqueue_puts_the_item_back_and_returns_500(
        self, client: AsyncClient, test_user, auth_headers, db_session: AsyncSession
    ):
        item = await _make_item(
            db_session,
            test_user,
            status=ItemStatus.error,
            processing_kind="background_removal",
        )
        item_id = item.id

        with _fake_queue() as redis:
            redis.enqueue_job.side_effect = RuntimeError("redis down")
            response = await client.post(
                f"/api/v1/items/{item_id}/remove-background",
                json={},
                headers=auth_headers,
            )

        assert response.status_code == 500

        db_session.expire_all()
        result = await db_session.execute(select(ClothingItem).where(ClothingItem.id == item_id))
        refreshed = result.scalar_one()
        # Back to what it was, so the user can simply retry.
        assert refreshed.status == ItemStatus.error
        assert refreshed.processing_kind == "background_removal"
        assert refreshed.ai_job_id is None


class TestHealthFeatures:
    @pytest.mark.asyncio
    async def test_features_endpoint(self, client: AsyncClient):
        response = await client.get("/api/v1/health/features")
        assert response.status_code == 200
        data = response.json()
        assert "background_removal" in data
        assert isinstance(data["background_removal"], bool)
