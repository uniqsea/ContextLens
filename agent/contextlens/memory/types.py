"""What the memory system is made of. Everything else in the package works on these."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

ORDINARY = "ordinary"  # the scope of ordinary sessions; any other scope is a project id


@dataclass(frozen=True)
class Memory:
    """One thing learned, with what was going on at the time. Understanding is not stored: it forms
    when the memories lit up by the present situation are read together."""
    id: str
    scope: str
    learned: str
    situation: str = ""
    source: Literal["said", "inferred", "read"] = "said"  # what was read is not what the user said
    concepts: list[str] = field(default_factory=list)
    scenes: list[str] = field(default_factory=list)
    state: Literal["active", "superseded", "forgotten"] = "active"
    always_on: bool = False
    check_at: str | None = None  # when this time-bound fact should be looked at again
    superseded_by: str | None = None  # the next entry on its timeline
    created_at: str = ""


@dataclass(frozen=True)
class Concept:
    """An independently standing thing: me, a person, a project. Holds no written understanding."""
    id: str
    name: str
    aliases: list[str] = field(default_factory=list)
    part_of: str | None = None
    merged_into: str | None = None


@dataclass(frozen=True)
class Scene:
    """A large, soft part of life the user chose. A way in and a light weight, never a wall."""
    id: str
    name: str
    definition: str = ""  # what it is for and what it takes in; the name alone leaves the edges to guesswork
    state: Literal["active", "proposed", "dismissed"] = "active"
    reason: str | None = None


@dataclass(frozen=True)
class Project:
    """A hard boundary. Isolated means nothing gets in or out; shared projects also read ordinary."""
    id: str
    name: str
    isolated: bool = True


@dataclass(frozen=True)
class Question:
    """Something upkeep could not settle from the evidence and asks the user instead."""
    id: str
    scope: str
    text: str
    memory_ids: list[str] = field(default_factory=list)
    state: Literal["open", "answered"] = "open"
    answer: str | None = None


Entity = Memory | Concept | Scene | Project | Question


@dataclass(frozen=True)
class Source:
    """Who makes a change, where it came from and why, so it can be traced and undone."""
    actor: Literal["user", "agent", "after_turn", "upkeep", "seed", "import"]
    thread_id: str | None = None
    turn: int | None = None
    reason: str | None = None
    evidence: str | None = None


class MemoryError(ValueError):
    """A change that cannot be made."""
