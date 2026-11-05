"""What comes to mind right now. The present situation lights up memories; the agent reads them.

Always-on facts come along every turn. The rest are scored on concepts in play, on how alike the
moment is to when the memory formed, and on how alike its content is to the question. A scene alone
never brings a memory up: scenes are coarse, so they only tip the balance. The weights are a first
guess held to `scripts/evaluate_recall.py`, not a measured result.
"""
from __future__ import annotations

import math
from collections import Counter
from datetime import date

from . import llm, operations, search
from .store import memories_in, session
from .types import Memory

WEIGHTS = {"concepts": 0.4, "moment": 0.3, "content": 0.25, "scene": 0.05}
THRESHOLD = 0.18  # a concept that is everywhere, with nothing else in common, stays below this
LIMIT = 6
BUDGET = 2400  # characters of memory text in one recollection
_DIMMED = 0.3
_BRIGHTENED = 2.0


def recall(question: str, situation: dict, scope: str, *, brighten: list[str] | None = None,
           dim: list[str] | None = None, limit: int = LIMIT, leave_out: set[str] | None = None,
           allowed_ids: set[str] | None = None, local_only: bool = False) -> dict:
    """{"always_on": [...], "memories": [...], "crowded": [ids]}, each memory saying why it came up.
    Crowded memories were relevant enough but did not fit the count or the budget."""
    bright, dark = set(brighten or []), set(dim or [])
    named = {c.id: c.name for c in operations.concepts_named(situation.get("concepts", []))}
    with session() as conn:
        visible = [m for m in memories_in(operations.visible_scopes(scope), conn) if m.id not in (leave_out or ())
                   and (allowed_ids is None or m.id in allowed_ids)]
        always_on = [m for m in visible if m.always_on]
        pool = [m for m in visible if not m.always_on]
        embedder = llm.embedder(local_only=local_only) if pool else None
        moment = search.similarity(conn, situation.get("doing", ""), "situation", pool, embedder)
        content = search.similarity(conn, question, "learned", pool, embedder)
    weight = _concept_weights(visible)
    scenes = set(situation.get("scenes", []))
    ranked = []
    scores = {}
    for memory in pool:
        lit = [c for c in memory.concepts if (c in named or c in bright) and c not in dark]
        concepts = min(1.0, sum(weight[c] * (_BRIGHTENED if c in bright else 1.0) for c in lit))
        parts = {"concepts": concepts, "moment": moment.get(memory.id, 0.0), "content": content.get(memory.id, 0.0)}
        if not any(parts.values()):
            continue
        shared = sorted(scenes & set(memory.scenes))
        score = sum(WEIGHTS[k] * v for k, v in parts.items()) + (WEIGHTS["scene"] if shared else 0.0)
        if dark & set(memory.concepts):
            score *= _DIMMED
        scores[memory.id] = round(score, 3)
        if score >= THRESHOLD:
            ranked.append((score, memory, parts, shared, lit))
    ranked.sort(key=lambda r: (-r[0], r[1].id))
    chosen, crowded, used = [], [], 0
    for score, memory, parts, shared, lit in ranked:
        used += len(memory.learned)
        if len(chosen) == limit or (chosen and used > BUDGET):
            crowded.append(memory.id)
            continue
        names = [named.get(c) for c in lit]
        chosen.append(_brief(memory) | {"score": round(score, 3), "why": {
            "concepts": sorted(filter(None, names)), "moment": round(parts["moment"], 3),
            "content": round(parts["content"], 3), "scenes": shared}})
    return {"always_on": [_brief(m) for m in always_on], "memories": chosen, "crowded": crowded, "scores": scores}


def render(memories: list[dict]) -> str:
    return "\n".join(f"- [{m['id']}] {m['learned']} ({note(m)})" for m in memories)


def _concept_weights(memories: list[Memory]) -> dict[str, float]:
    """A concept that shows up everywhere says little about any one memory, whatever the concept."""
    counts = Counter(c for m in memories for c in m.concepts)
    return {c: 1 / math.log2(2 + n) for c, n in counts.items()}


def _brief(memory: Memory) -> dict:
    return {"id": memory.id, "learned": memory.learned, "situation": memory.situation, "source": memory.source,
            "created_at": memory.created_at, "scope": memory.scope,
            "due": bool(memory.check_at and memory.check_at <= date.today().isoformat())}


def note(memory: dict) -> str:
    """What the model should know about a memory beyond its words."""
    parts = [f"noted {memory['created_at'][:10]}"]
    if memory["situation"]:
        parts.append(f"while {memory['situation']}")
    if memory["source"] != "said":
        parts.append("inferred, not said by the user" if memory["source"] == "inferred" else "from something read")
    if memory["due"]:
        parts.append("may be out of date")
    return "; ".join(parts)
