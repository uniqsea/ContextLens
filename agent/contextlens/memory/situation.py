"""Read the moment before memory is used: which scenes, what is being done, which things are named.

The one reading serves both directions: recall uses it to decide what comes to mind, and memories
written this turn keep it as what was going on at the time. Its failure never costs the turn.
"""
from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from . import language, llm, operations
from .types import Source

log = logging.getLogger(__name__)
_RECENT_MESSAGES = 6
_KNOWN_CONCEPTS = 150
_MISFITS_BEFORE_PROPOSING = 3
_MOST_SCENES = 2

_INSTRUCTIONS = """You read the moment in a conversation for an assistant's memory. From the latest
message, in light of the recent ones, say:
- scenes: which of the user's scenes this belongs to, judged by what it is for rather than its subject and
  by each scene's definition. Only from the list, the main one first. One; a second only if it truly spans
  two; none is fine.
- doing: one short sentence on what the user is doing right now, specific enough to tell this moment
  from another about the same people or things. In {language}, starting from the verb, with no
  subject. Say what they are doing, not what they asked for: "revising chapter two of the thesis", not
  "the user asks about a word".
- concepts: the independently standing things actually named or plainly meant in these messages: people,
  projects, works, organisations, and the user themself as "我" only when the message turns on who they
  are or what they like. The known names are for spelling, not a menu: leave out any not in play. Use the
  known name or alias when one fits, otherwise the name as said. Not topics, moods or everyday words.
- new_scene: only if this clearly belongs to none of the scenes, a large area of life worth adding,
  named in a word or two. Usually empty.
- new_scene_definition: with new_scene, one sentence on what it is for and what it takes in.

Example (the language of doing aside), with scenes Work, Study, Life and known concepts 周老师, 晴川:
"我在改毕业论文第二章，周老师会在意什么？" -> scenes ["Study"], doing "修改毕业论文第二章",
concepts ["周老师"]; not Work or Life, and not 晴川, which nothing here mentions."""


_SUGGEST = """People tell a personal assistant which broad situations their life with it falls into, so
it can tell what kind of moment each conversation is. From how this user describes using it, suggest the
situations that fit them. Keep what already fits from their current list, word for word, and add only what
is missing.
- Each is a large, lasting area of life, named in a word or two in the user's language: "work", not
  "revising my thesis"; a single project or task is not a situation.
- Together they should cover nearly everything the user does, and rarely overlap: most conversations
  should clearly belong to just one. Prefer fewer and broader; usually three, more only if the description
  clearly needs it.
- definition: one sentence in the user's language on what it is for, then what it takes in. Name what it
  takes in; never define one as "everything else".
- reason: one short sentence, in the user's language, tying it to what they said."""


class SuggestedSituation(BaseModel):
    name: str
    definition: str
    reason: str


class SuggestedSituations(BaseModel):
    situations: list[SuggestedSituation]


def suggest_situations(description: str, current: list[dict]) -> list[dict]:
    """Situations for the user to agree to. Nothing is saved here; a model failure reaches the caller."""
    prompt = f"Current situations:\n{_listed(current)}\n\nHow they use it:\n{description}"
    found = llm.structured(SuggestedSituations, _SUGGEST, prompt).situations
    return [{"name": s.name.strip(), "definition": s.definition.strip(), "reason": s.reason.strip()}
            for s in found if s.name.strip()]


def _listed(scenes: list[dict]) -> str:
    return "\n".join(f"- {s['name']}: {s.get('definition', '')}" for s in scenes) or "none"


class Reading(BaseModel):
    scenes: list[str] = Field(default_factory=list)
    doing: str
    concepts: list[str] = Field(default_factory=list)
    new_scene: str | None = None
    new_scene_definition: str = ""


def identify(messages: list[tuple[str, str]], scope: str) -> dict:
    """The reading of the moment; if the model fails, the bare message stands in for what is going on."""
    question = messages[-1][1] if messages else ""
    active = operations.active_scenes()
    scenes = [s.name for s in active]
    known = [" / ".join([c["name"], *c["aliases"]]) for c in operations.concepts_in(scope)[:_KNOWN_CONCEPTS]]
    recent = "\n".join(f"{role}: {text}" for role, text in messages[-_RECENT_MESSAGES:])
    listed = _listed([{"name": s.name, "definition": s.definition} for s in active])
    prompt = f"Scenes:\n{listed}\nKnown concepts: {known or 'none yet'}\n\nConversation:\n{recent}"
    try:
        reading = llm.structured(Reading, _INSTRUCTIONS.format(language=language.name()), prompt)
    except Exception as e:
        log.warning("reading the moment failed: %s: %s", type(e).__name__, str(e)[:300])
        return {"scenes": [], "doing": question[:80], "concepts": [], "new_scene": None, "degraded": True}
    return {"scenes": [s for s in dict.fromkeys(reading.scenes) if s in scenes][:_MOST_SCENES],
            "doing": reading.doing.strip() or question[:80],
            "concepts": _in_play(reading.concepts, recent, scope), "new_scene": reading.new_scene or None,
            "new_scene_definition": reading.new_scene_definition, "degraded": False}


def read_plainly(text: str, scope: str) -> dict:
    """A reading with no model call, for previewing while the user types: their words stand in for
    what is going on, and the known concepts they name are in play."""
    lowered = text.lower()
    named = [c["name"] for c in operations.concepts_in(scope)
             if any(n.lower() in lowered for n in (c["name"], *c["aliases"]))]
    return {"scenes": [], "doing": text, "concepts": named, "new_scene": None, "degraded": False}


def _in_play(names: list[str], recent: str, scope: str) -> list[str]:
    """Small models pick from a list because it is there: a known concept counts only if the
    conversation actually says one of its names. Names it does not know yet are taken as said."""
    text = recent.lower()
    known = {n.lower(): [c["name"], *c["aliases"]] for c in operations.concepts_in(scope)
             for n in (c["name"], *c["aliases"])}
    return [n for n in dict.fromkeys(names) if n == operations.SELF or n.lower() not in known
            or any(alias.lower() in text for alias in known[n.lower()])]


def propose_if_unfit(earlier: list[dict], situation: dict, source: Source) -> list[dict]:
    """Several turns in a row fit no scene: put the latest suggestion to the user."""
    latest = [*earlier, {"situation": situation}][-_MISFITS_BEFORE_PROPOSING:]
    if len(latest) < _MISFITS_BEFORE_PROPOSING or not all(t["situation"].get("new_scene") for t in latest):
        return []
    return operations.propose_scene(situation["new_scene"], f"Recent turns fit no scene: {situation['doing']}", source,
                                    situation.get("new_scene_definition", ""))
