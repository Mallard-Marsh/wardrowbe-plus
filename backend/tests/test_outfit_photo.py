"""Logging an outfit from a photo of the person: the wardrobe shortlist, the reply parser and the
endpoint that finds the garments and matches them (writing nothing, keeping no photo)."""

import json
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemStatus
from app.models.user import User
from app.services.garment_detector import DetectedGarment
from app.services.image_service import ImageService
from app.services.outfit_photo_matcher import (
    CANDIDATES_PER_GARMENT,
    GarmentCandidates,
    parse_matches,
    shortlist,
)


def _item(type_, primary=None, colors=None):
    return SimpleNamespace(id=uuid4(), type=type_, primary_color=primary, colors=colors or [])


class TestShortlist:
    def test_same_type_beats_same_role_beats_other_roles(self):
        shirt = _item("shirt", "blue", ["blue"])
        tee = _item("t-shirt", "blue", ["blue"])  # same role (base top), other type
        jeans = _item("jeans", "blue", ["blue"])

        [group] = shortlist([("shirt", ["blue"])], [jeans, tee, shirt])

        assert [c.item for c in group.candidates] == [shirt, tee]  # jeans are not a top

    def test_colour_orders_items_of_the_same_type(self):
        navy = _item("t-shirt", "navy", ["navy"])
        white = _item("t-shirt", "white", ["white"])
        red = _item("t-shirt", "red", ["red"])

        [group] = shortlist([("t-shirt", ["white"])], [navy, red, white])

        assert group.candidates[0].item is white

    def test_footwear_types_count_as_the_same_family(self):
        sneakers = _item("sneakers", "white", ["white"])
        boots = _item("boots", "black", ["black"])
        shirt = _item("shirt", "white", ["white"])

        [group] = shortlist([("shoes", ["white"])], [shirt, boots, sneakers])

        assert [c.item for c in group.candidates] == [sneakers, boots]

    def test_an_unknown_garment_type_is_matched_by_colour_alone(self):
        green = _item("hat", "green", ["green"])
        navy = _item("shirt", "navy", ["navy"])

        [group] = shortlist([("unknown", ["green"])], [navy, green])

        assert group.candidates[0].item is green

    def test_the_list_is_capped(self):
        items = [_item("shirt", "blue", ["blue"]) for _ in range(10)]

        [group] = shortlist([("shirt", ["blue"])], items)

        assert len(group.candidates) == CANDIDATES_PER_GARMENT

    def test_candidates_are_numbered_across_all_garments(self):
        shirt = _item("shirt", "blue", ["blue"])
        jeans = _item("jeans", "blue", ["blue"])

        groups = shortlist([("shirt", ["blue"]), ("jeans", ["blue"])], [shirt, jeans])

        assert [c.number for g in groups for c in g.candidates] == [1, 2]

    def test_a_garment_with_nothing_plausible_gets_an_empty_list(self):
        [group] = shortlist([("dress", [])], [_item("shoes", "black", ["black"])])

        assert group.candidates == []


def _groups():
    shirt, jeans, tee = _item("shirt"), _item("jeans"), _item("t-shirt")
    groups = shortlist([("shirt", []), ("jeans", [])], [shirt, jeans, tee])
    return groups, shirt, jeans, tee


class TestParseMatches:
    def test_reads_a_match_per_garment(self):
        groups, shirt, jeans, _ = _groups()
        reply = json.dumps(
            {
                "matches": [
                    {"garment": 1, "candidate": groups[0].candidates[0].number, "confidence": 0.9},
                    {"garment": 2, "candidate": None, "confidence": 0},
                ]
            }
        )

        first, second = parse_matches(reply, groups)

        assert (first.item_id, first.confidence) == (shirt.id, 0.9)
        assert second.item_id is None

    def test_a_candidate_offered_for_another_garment_is_not_believed(self):
        groups, *_ = _groups()
        jeans_number = groups[1].candidates[0].number
        reply = json.dumps(
            {"matches": [{"garment": 1, "candidate": jeans_number, "confidence": 1}]}
        )

        assert parse_matches(reply, groups)[0].item_id is None

    def test_an_item_chosen_twice_stays_with_the_more_confident_garment(self):
        shirt = _item("shirt")
        groups = [
            GarmentCandidates(0, [SimpleNamespace(number=1, item=shirt, score=1)]),
            GarmentCandidates(1, [SimpleNamespace(number=2, item=shirt, score=1)]),
        ]
        reply = json.dumps(
            {
                "matches": [
                    {"garment": 1, "candidate": 1, "confidence": 0.6},
                    {"garment": 2, "candidate": 2, "confidence": 0.9},
                ]
            }
        )

        first, second = parse_matches(reply, groups)

        assert first.item_id is None
        assert second.item_id == shirt.id

    def test_confidence_is_clamped_and_junk_confidence_is_zero(self):
        groups, shirt, *_ = _groups()
        number = groups[0].candidates[0].number

        high = parse_matches(
            json.dumps({"matches": [{"garment": 1, "candidate": number, "confidence": 7}]}), groups
        )[0]
        junk = parse_matches(
            json.dumps({"matches": [{"garment": 1, "candidate": number, "confidence": "sure"}]}),
            groups,
        )[0]

        assert high.confidence == 1.0
        assert junk.confidence == 0.0 and junk.item_id == shirt.id

    def test_accepts_fenced_json(self):
        groups, shirt, *_ = _groups()
        number = groups[0].candidates[0].number
        reply = f'```json\n{{"matches": [{{"garment": 1, "candidate": {number}, "confidence": 0.7}}]}}\n```'

        assert parse_matches(reply, groups)[0].item_id == shirt.id

    @pytest.mark.parametrize(
        "reply",
        [
            "",
            "no idea",
            "{broken",
            "[]",
            '{"matches": "none"}',
            '{"matches": [1, "a", null, {"garment": "x"}, {"garment": 9, "candidate": 1}]}',
            '{"matches": [{"garment": true, "candidate": 1}, {"garment": 1, "candidate": true}]}',
        ],
    )
    def test_unusable_replies_match_nothing_but_keep_one_entry_per_garment(self, reply):
        groups, *_ = _groups()

        result = parse_matches(reply, groups)

        assert [m.item_id for m in result] == [None, None]


def _photo_bytes(size=(300, 500)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", size, (90, 120, 150)).save(buf, format="JPEG")
    return buf.getvalue()


async def _wardrobe_item(db_session: AsyncSession, user, type_, color, **extra) -> ClothingItem:
    paths = await ImageService().process_and_store(
        user_id=user.id, image_data=_photo_bytes((120, 160)), original_filename="x.jpg"
    )
    item = ClothingItem(
        user_id=user.id,
        type=type_,
        primary_color=color,
        colors=[color],
        image_path=paths["image_path"],
        medium_path=paths["medium_path"],
        thumbnail_path=paths["thumbnail_path"],
        image_hash=paths["image_hash"],
        status=ItemStatus.ready,
        **extra,
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(item)
    return item


def _ai(garments, reply=None, match_error=None, detect_error=None, seen=None):
    ai = MagicMock()

    async def detect(path):
        if seen is not None:
            seen.append(path)
            seen.append(path.exists())
        if detect_error:
            raise detect_error
        return garments

    ai.detect_garments = detect
    ai.match_outfit_photo = AsyncMock(side_effect=match_error, return_value=reply)
    return ai


def _post(client, headers, content=None, content_type="image/jpeg"):
    return client.post(
        "/api/v1/outfits/from-photo",
        files={"image": ("me.jpg", content or _photo_bytes(), content_type)},
        headers=headers,
    )


SHIRT = DetectedGarment("shirt", ["blue"], 0.1, 0.1, 0.5, 0.3)
JEANS = DetectedGarment("jeans", ["blue"], 0.1, 0.5, 0.4, 0.45)


class TestFromPhotoEndpoint:
    @pytest.mark.asyncio
    async def test_matches_each_garment_and_lists_the_candidates(
        self, client: AsyncClient, db_session: AsyncSession, test_user, auth_headers
    ):
        shirt = await _wardrobe_item(db_session, test_user, "shirt", "blue", name="Blue shirt")
        await _wardrobe_item(db_session, test_user, "t-shirt", "blue")
        jeans = await _wardrobe_item(db_session, test_user, "jeans", "blue")
        shirt_id, jeans_id = str(shirt.id), str(jeans.id)
        ai = _ai(
            [SHIRT, JEANS],
            reply=json.dumps(
                {
                    "matches": [
                        {"garment": 1, "candidate": 1, "confidence": 0.9},
                        {"garment": 2, "candidate": None, "confidence": 0},
                    ]
                }
            ),
        )

        with patch("app.api.outfit_photo.get_ai_service", return_value=ai):
            response = await _post(client, auth_headers)

        assert response.status_code == 200
        first, second = response.json()["garments"]
        assert first["type"] == "shirt"
        assert first["box"] == {"left": 0.1, "top": 0.1, "width": 0.5, "height": 0.3}
        assert first["match"] == {"item_id": shirt_id, "confidence": 0.9}
        assert first["candidates"][0]["item_id"] == shirt_id
        assert first["candidates"][0]["name"] == "Blue shirt"
        assert first["candidates"][0]["thumbnail_url"]
        assert second["match"] is None
        assert {c["item_id"] for c in second["candidates"]} == {jeans_id}

    @pytest.mark.asyncio
    async def test_the_model_is_shown_the_photo_and_numbered_candidate_photos(
        self, client: AsyncClient, db_session: AsyncSession, test_user, auth_headers
    ):
        await _wardrobe_item(db_session, test_user, "shirt", "blue")
        ai = _ai([SHIRT], reply='{"matches": []}')

        with patch("app.api.outfit_photo.get_ai_service", return_value=ai):
            await _post(client, auth_headers)

        ai.match_outfit_photo.assert_awaited_once()
        garments, candidates = ai.match_outfit_photo.await_args.args
        assert [(n, t, c) for n, t, c, _ in garments] == [(1, "shirt", ["blue"])]
        with Image.open(BytesIO(garments[0][3])) as crop:
            # the shirt box is 50% x 30% of a 300x500 photo, plus 5% room each side
            assert 150 <= crop.width <= 180 and 150 <= crop.height <= 175
        assert [(n, g) for n, g, _ in candidates] == [(1, 1)]
        assert candidates[0][2].exists()

    @pytest.mark.asyncio
    async def test_only_the_users_own_active_items_are_candidates(
        self, client: AsyncClient, db_session: AsyncSession, test_user, auth_headers
    ):
        other = User(
            id=uuid4(),
            external_id=f"o-{uuid4()}",
            email=f"o-{uuid4()}@example.com",
            display_name="Other",
            timezone="UTC",
            is_active=True,
            onboarding_completed=False,
        )
        db_session.add(other)
        await db_session.commit()
        mine = await _wardrobe_item(db_session, test_user, "shirt", "blue")
        await _wardrobe_item(db_session, test_user, "shirt", "blue", is_archived=True)
        await _wardrobe_item(db_session, other, "shirt", "blue")
        mine_id = str(mine.id)

        with patch("app.api.outfit_photo.get_ai_service", return_value=_ai([SHIRT], reply="{}")):
            response = await _post(client, auth_headers)

        [garment] = response.json()["garments"]
        assert [c["item_id"] for c in garment["candidates"]] == [mine_id]

    @pytest.mark.asyncio
    async def test_no_garments_found_is_an_empty_list_without_matching(
        self, client: AsyncClient, auth_headers
    ):
        ai = _ai([])

        with patch("app.api.outfit_photo.get_ai_service", return_value=ai):
            response = await _post(client, auth_headers)

        assert response.status_code == 200
        assert response.json() == {"garments": []}
        ai.match_outfit_photo.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_with_nothing_plausible_in_the_wardrobe_no_matching_call_is_made(
        self, client: AsyncClient, db_session: AsyncSession, test_user, auth_headers
    ):
        await _wardrobe_item(db_session, test_user, "shoes", "black")
        ai = _ai([SHIRT])

        with patch("app.api.outfit_photo.get_ai_service", return_value=ai):
            response = await _post(client, auth_headers)

        [garment] = response.json()["garments"]
        assert garment["candidates"] == [] and garment["match"] is None
        ai.match_outfit_photo.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_failed_matching_call_still_returns_the_garments(
        self, client: AsyncClient, db_session: AsyncSession, test_user, auth_headers
    ):
        await _wardrobe_item(db_session, test_user, "shirt", "blue")
        ai = _ai([SHIRT], match_error=RuntimeError("down"))

        with patch("app.api.outfit_photo.get_ai_service", return_value=ai):
            response = await _post(client, auth_headers)

        assert response.status_code == 200
        [garment] = response.json()["garments"]
        assert garment["match"] is None and len(garment["candidates"]) == 1

    @pytest.mark.asyncio
    async def test_the_photo_is_not_kept(self, client: AsyncClient, auth_headers):
        seen: list = []

        with patch("app.api.outfit_photo.get_ai_service", return_value=_ai([], seen=seen)):
            await _post(client, auth_headers)

        path, existed_during = seen
        assert existed_during is True
        assert not path.exists()

    @pytest.mark.asyncio
    async def test_the_photo_is_shrunk_before_it_goes_to_the_ai(
        self, client: AsyncClient, auth_headers
    ):
        sizes: list = []
        ai = MagicMock()

        async def detect(path):
            with Image.open(path) as im:
                sizes.append(im.size)
            return []

        ai.detect_garments = detect

        with patch("app.api.outfit_photo.get_ai_service", return_value=ai):
            await _post(client, auth_headers, content=_photo_bytes((3000, 2000)))

        assert max(sizes[0]) == 1600

    @pytest.mark.asyncio
    async def test_ai_disabled_is_503(self, client: AsyncClient, auth_headers):
        from app.services.ai_service import AIDisabledError

        with patch("app.api.outfit_photo.get_ai_service", side_effect=AIDisabledError("off")):
            response = await _post(client, auth_headers)

        assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_unreachable_ai_is_502(self, client: AsyncClient, auth_headers):
        ai = _ai([], detect_error=RuntimeError("down"))

        with patch("app.api.outfit_photo.get_ai_service", return_value=ai):
            response = await _post(client, auth_headers)

        assert response.status_code == 502

    @pytest.mark.asyncio
    async def test_a_file_that_is_not_an_image_is_400(self, client: AsyncClient, auth_headers):
        with patch("app.api.outfit_photo.get_ai_service", return_value=_ai([])):
            response = await _post(client, auth_headers, content=b"not an image")

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_is_rate_limited(self, client: AsyncClient, auth_headers):
        with patch("app.api.outfit_photo.get_ai_service", return_value=_ai([])):
            codes = [(await _post(client, auth_headers)).status_code for _ in range(11)]

        assert codes[:10] == [200] * 10
        assert codes[10] == 429

    @pytest.mark.asyncio
    async def test_requires_auth(self, client: AsyncClient):
        response = await client.post(
            "/api/v1/outfits/from-photo", files={"image": ("me.jpg", _photo_bytes(), "image/jpeg")}
        )

        assert response.status_code in (401, 403)
