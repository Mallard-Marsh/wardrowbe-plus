"""Matching the garments found in a photo of a person to items in their wardrobe.

Two parts, both free of the network: a shortlist (which wardrobe items are even plausible for a
garment, by type family and colour, so the model is shown a handful of thumbnails rather than the
whole wardrobe) and a parser for the model's answer.
"""

import json
import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from app.utils.garment_vocabulary import ITEM_ROLE

logger = logging.getLogger(__name__)

CANDIDATES_PER_GARMENT = 4
# A match the model is less sure of than this is offered as a suggestion at most; the screen still
# lets the person pick, but nothing is pre-ticked below it.
MIN_MATCH_CONFIDENCE = 0.5


class WardrobeItem(Protocol):
    id: object
    type: str
    primary_color: str | None
    colors: list[str] | None


@dataclass(frozen=True)
class Candidate:
    number: int
    item: WardrobeItem
    score: float


@dataclass(frozen=True)
class GarmentCandidates:
    garment_index: int
    candidates: list[Candidate] = field(default_factory=list)


@dataclass(frozen=True)
class GarmentMatch:
    garment_index: int
    item_id: object | None
    confidence: float


def _score(garment_type: str, garment_colors: Sequence[str], item: WardrobeItem) -> float:
    """How plausible an item is for a garment; zero means not at all."""
    garment_role = ITEM_ROLE.get(garment_type)
    item_role = ITEM_ROLE.get(item.type)
    if garment_type == "unknown" or garment_role is None:
        score = 1.0  # the type is no help, so colour decides
    elif item.type == garment_type:
        score = 10.0
    elif item_role == garment_role:
        score = 5.0  # shoes for sneakers, a jacket for a blazer
    else:
        return 0.0

    item_colors = set(item.colors or [])
    if item.primary_color:
        item_colors.add(item.primary_color)
    shared = item_colors & set(garment_colors)
    if garment_colors and item.primary_color == garment_colors[0]:
        score += 4.0
    score += 2.0 * min(len(shared), 2)
    return score


def shortlist(
    garments: Sequence[tuple[str, Sequence[str]]],
    items: Sequence[WardrobeItem],
    limit: int = CANDIDATES_PER_GARMENT,
) -> list[GarmentCandidates]:
    """For each (type, colours) garment, its most plausible wardrobe items, numbered across the
    whole answer (1, 2, 3...) so the model can name a candidate with one number."""
    result: list[GarmentCandidates] = []
    number = 1
    for index, (garment_type, colors) in enumerate(garments):
        scored = sorted(
            ((_score(garment_type, colors, item), item) for item in items),
            key=lambda pair: -pair[0],
        )
        picked = []
        for score, item in scored:
            if score <= 0 or len(picked) == limit:
                break
            picked.append(Candidate(number=number, item=item, score=score))
            number += 1
        result.append(GarmentCandidates(garment_index=index, candidates=picked))
    return result


def _extract_json(text: str) -> object | None:
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


def parse_matches(response_text: str, groups: Sequence[GarmentCandidates]) -> list[GarmentMatch]:
    """One match per garment (item_id None when the model found none or answered badly).

    The model is only believed for a candidate that was offered for that very garment, and an item
    chosen for two garments goes to the one the model was surer of.
    """
    data = _extract_json(response_text)
    entries = data.get("matches") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        entries = []

    by_garment: dict[int, GarmentMatch] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        garment = entry.get("garment")
        candidate = entry.get("candidate")
        confidence = entry.get("confidence")
        if isinstance(garment, bool) or not isinstance(garment, int):
            continue
        index = garment - 1
        if not 0 <= index < len(groups) or index in by_garment:
            continue
        if isinstance(candidate, bool) or not isinstance(candidate, int):
            continue
        chosen = next((c for c in groups[index].candidates if c.number == candidate), None)
        if chosen is None:
            continue
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            confidence = 0.0
        by_garment[index] = GarmentMatch(
            index, chosen.item.id, min(max(float(confidence), 0.0), 1.0)
        )

    # An item cannot be two garments at once: it stays with the more confident one.
    best_for_item: dict[object, GarmentMatch] = {}
    for match in by_garment.values():
        held = best_for_item.get(match.item_id)
        if held is None or match.confidence > held.confidence:
            best_for_item[match.item_id] = match
    kept = {m.garment_index for m in best_for_item.values()}

    return [
        by_garment[i] if i in by_garment and i in kept else GarmentMatch(i, None, 0.0)
        for i in range(len(groups))
    ]
