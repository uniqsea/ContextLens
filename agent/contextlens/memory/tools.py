"""The agent's memory tools. Everything they read is limited to what the turn's scope can see, and
everything they write is an event with the reason given and what the user had said.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from langchain.tools import ToolRuntime, tool

from contextlens.turn_trace import capture_calls

from . import operations
from .recall import recall as recollect
from .recall import render
from .situation import identify
from .store import memories_in
from .types import MemoryError, Source


@dataclass
class TurnContext:
    question: str = ""
    scope: str = "ordinary"
    situation: dict = field(default_factory=dict)
    thread_id: str | None = None
    turn: int | None = None
    # None preserves automatic lookup for callers without an explicit context selection.
    allowed_context: set[str] | None = None


Runtime = ToolRuntime[TurnContext]


@tool("identify_situation", response_format="content_and_artifact")
def identify_situation(what_changed: str, runtime: Runtime) -> tuple[str, dict]:
    """Read the situation again when the task has moved on from where the turn began, and bring up the
    memories for it. Say what changed in your own words."""
    ctx = runtime.context
    with capture_calls() as calls:
        situation = identify([("user", ctx.question), ("assistant", what_changed)], ctx.scope, allowed_ids=ctx.allowed_context)
    found = recollect(what_changed, situation, ctx.scope, allowed_ids=ctx.allowed_context)["memories"]
    text = f"Now: {situation['doing']}\n{render(found) or 'Nothing further comes to mind.'}"
    return text, {"situation": situation, "memories": found, "reading_calls": list(calls)}


@tool("recall", response_format="content_and_artifact")
def recall_tool(query: str, runtime: Runtime) -> tuple[str, dict]:
    """Search memory beyond what you were given, when the task depends on the user or past work."""
    ctx = runtime.context
    found = recollect(query, ctx.situation, ctx.scope, allowed_ids=ctx.allowed_context)["memories"]
    return render(found) or "No memory matches.", {"memories": found}


@tool("open_concept", response_format="content_and_artifact")
def open_concept(name: str, runtime: Runtime) -> tuple[str, dict]:
    """Read everything remembered here about one thing: a person, a project, the user ("我")."""
    concepts = operations.concepts_named([name])
    if not concepts:
        return f"Nothing is remembered about {name}.", {"memories": []}
    found = [m for m in memories_in(operations.visible_scopes(runtime.context.scope))
             if concepts[0].id in m.concepts and
             (runtime.context.allowed_context is None or m.id in runtime.context.allowed_context)]
    lines = [f"- [{m.id}] {m.learned}" + (f" (while {m.situation})" if m.situation else "") for m in found]
    return "\n".join(lines) or f"Nothing is remembered about {name}.", {"memories": [m.id for m in found]}


@tool("remember", response_format="content_and_artifact")
def remember(learned: str, reason: str, runtime: Runtime, concepts: list[str] | None = None,
             check_at: str | None = None, replaces: str | None = None) -> tuple[str, dict]:
    """Write something down now: when the user asks you to remember it, or you have just learned
    something that later work will need. One sentence, in the language your instructions say memories
    are written in. concepts: at most three
    things it is about that you could point at (a person, a project, a work; "我" for the user), never
    a topic. check_at: ISO date to look at a time-bound fact again. replaces: the id of the memory it
    takes over from, when the world changed."""
    ctx = runtime.context
    return _write(lambda s: operations.add_memory(
        learned, s, scope=ctx.scope, situation=ctx.situation.get("doing", ""), concepts=concepts,
        scenes=ctx.situation.get("scenes", []), check_at=check_at,
        replaces=_mine(replaces, ctx) if replaces else None), reason, runtime, "Saved.")


@tool("revise", response_format="content_and_artifact")
def revise(memory_id: str, learned: str, reason: str, runtime: Runtime) -> tuple[str, dict]:
    """Correct a memory that was wrong all along. If the world changed instead, use remember with
    replaces, so the older fact stays on the timeline."""
    return _write(lambda s: operations.revise(_mine(memory_id, runtime.context), {"learned": learned}, s),
                  reason, runtime, "Corrected.")


@tool("forget", response_format="content_and_artifact")
def forget(memory_id: str, reason: str, runtime: Runtime) -> tuple[str, dict]:
    """Stop using a memory that should not have been kept. The user can bring it back."""
    return _write(lambda s: operations.forget(_mine(memory_id, runtime.context), s), reason, runtime, "Forgotten.")


@tool("link_concepts", response_format="content_and_artifact")
def link_concepts(memory_id: str, names: list[str], reason: str, runtime: Runtime) -> tuple[str, dict]:
    """Say which things a memory is also about."""
    return _write(lambda s: operations.link_concepts(_mine(memory_id, runtime.context), names, s),
                  reason, runtime, "Linked.")


@tool("propose_scene", response_format="content_and_artifact")
def propose_scene(name: str, definition: str, reason: str, runtime: Runtime) -> tuple[str, dict]:
    """Suggest a new scene, a large area of the user's life that none of theirs covers, saying what it is
    for and what it takes in. It takes effect only if the user agrees, and is asked once."""
    return _write(lambda s: operations.propose_scene(name, reason, s, definition), reason, runtime, "Put to the user.")


def _mine(memory_id: str, ctx: TurnContext) -> str:
    if ctx.allowed_context is not None and memory_id not in ctx.allowed_context:
        raise MemoryError("This memory was not included in the turn.")
    return operations.visible_memory(memory_id, ctx.scope).id


def _write(change, reason: str, runtime: Runtime, done: str) -> tuple[str, dict]:
    ctx = runtime.context
    source = Source("agent", thread_id=ctx.thread_id, turn=ctx.turn, reason=reason, evidence=ctx.question)
    try:
        return done, {"events": change(source)}
    except MemoryError as e:
        return f"Not done: {e}", {"events": []}


TOOLS = [identify_situation, recall_tool, open_concept, remember, revise, forget, link_concepts, propose_scene]
