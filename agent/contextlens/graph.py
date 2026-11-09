"""The app graph: one turn = snapshot the context, let the engine answer, record what happened,
then bring the memories up to date from what the user said.

A turn can later be rewritten with different context, or the rewrite undone; every version keeps
the exact request it was made from. Every memory change a turn caused is listed with it.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, NotRequired, TypedDict

from langchain_core.messages import AIMessage, AnyMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.channels.delta import DeltaChannel
from langgraph.graph.message import _messages_delta_reducer

from contextlens import conversations, engine, memory, models, records
from contextlens.context import message_pairs, prepare_snapshot
from contextlens.context.snapshot import estimate_tokens
from contextlens.provenance import Labels, parse_segments
from contextlens.turn_trace import capture_calls


def _by_turn(state: dict | None, writes: list[dict]) -> dict:
    """Per-turn entries, the latest write for a turn winning: a checkpoint keeps only the turns it changed."""
    merged = dict(state or {})
    for write in writes:
        merged.update(write)
    return merged


# DeltaChannels store what each checkpoint added, so a long conversation is not saved over and over.
class LensState(TypedDict):
    messages: Annotated[list[AnyMessage], DeltaChannel(_messages_delta_reducer, snapshot_frequency=50)]
    # The project this conversation belongs to; none means ordinary sessions.
    project_id: NotRequired[str | None]
    # Request-local choices for the next send: ids to leave out and memories to add.
    context_policies: NotRequired[list[dict]]
    manual_memory_ids: NotRequired[list[str]]
    input_order: NotRequired[list[str] | None]
    # Per answered turn: which memories and earlier turns it relied on (drives history validity).
    history_lineage: NotRequired[Annotated[dict, DeltaChannel(_by_turn, snapshot_frequency=50)]]
    # Per answered turn: every version of the answer with the request it came from.
    turn_records: NotRequired[Annotated[dict, DeltaChannel(_by_turn, snapshot_frequency=50)]]
    # Rewrite (or undo) one earlier answer instead of answering a new message.
    regen_request: NotRequired[dict | None]
    # The interface language the turn was sent from; memories follow it unless the user chose one.
    locale: NotRequired[str | None]


def answer_turn(state: LensState, config: RunnableConfig) -> dict:
    if state.get("locale") in models.settings.LANGUAGES:
        memory.language.choose(interface=state["locale"])
    excluded = sorted({p["item_id"] for p in state.get("context_policies", [])})
    order = state.get("input_order")
    allowed = set(order).difference(excluded) if order is not None else None
    with capture_calls() as reading_calls:
        situation = memory.identify(_conversation(state["messages"]), _scope(state), allowed_ids=allowed)
    earlier = [{"situation": r["versions"][-1].get("situation", {})} for r in state.get("turn_records", {}).values()]
    memory.propose_if_unfit(earlier, situation, memory.Source("after_turn", reason=situation["doing"]))
    snapshot = prepare_snapshot({**state, "situation": situation})
    index = len(message_pairs(state["messages"]))
    version = _make_version(snapshot, excluded, sorted(set(state.get("manual_memory_ids", []))), note=[],
                            situation=situation, scope=_scope(state), thread_id=_thread(config), turn=index)
    version["reading_calls"] = list(reading_calls)
    record = {"index": index, "query": snapshot["messages"][1]["content"], "versions": [version],
              "memory_changes": _tool_changes(version)}
    conversations.record_turn(_thread(config), state.get("project_id"), record["query"], version["content"])
    return {"messages": [AIMessage(content=version["content"])], "history_lineage": {str(index): version["lineage"]},
            "turn_records": {str(index): record}, "context_policies": [], "manual_memory_ids": [], "input_order": None}


def remember_turn(state: LensState, config: RunnableConfig) -> dict:
    """Memory upkeep for the turn just answered; its changes join those the agent made itself."""
    index = len(message_pairs(state["messages"])) - 1
    record = state["turn_records"][str(index)]
    version = record["versions"][-1]
    source = memory.Source("after_turn", thread_id=_thread(config), turn=index, evidence=record["query"])
    with capture_calls() as writing_calls:
        allowed = set(version["input_order"]) if "input_order" in version else None
        events = memory.remember_turn(record["query"], version["situation"], _scope(state), source, allowed_ids=allowed)
    memory.upkeep.run_if_due(_scope(state))
    changes = [_change(e) for e in records.changes(events)]
    version = {**version, "writing_calls": list(writing_calls), "written_changes": changes}
    record = {**record, "versions": [*record["versions"][:-1], version],
              "memory_changes": record.get("memory_changes", []) + changes}
    return {"turn_records": {str(index): record}}


def rewrite_turn(state: LensState, config: RunnableConfig) -> dict:
    req = state["regen_request"]
    i = int(req["turn"])
    human, ai = message_pairs(state["messages"])[i]
    record = dict(state["turn_records"][str(i)])
    if req.get("action") == "undo":
        if len(record["versions"]) < 2:
            return {"regen_request": None}
        record["versions"] = record["versions"][:-1]
    else:
        # The turn is answered again from its own point in the conversation.
        upto = state["messages"][:next(k for k, m in enumerate(state["messages"]) if m is human) + 1]
        excluded, pinned = sorted(set(req.get("excluded", []))), sorted(set(req.get("pinned", [])))
        before = record["versions"][-1]
        situation = {**before["situation"], **req.get("situation", {})}
        bright, dim = req.get("brighten", before["brighten"]), req.get("dim", before["dim"])
        order = before.get("input_order")
        if order is not None:
            order = list(dict.fromkeys([*order, *pinned]))
        snapshot = prepare_snapshot({
            **state, "input_order": req.get("input_order", order), "messages": upto, "situation": situation, "brighten": bright, "dim": dim,
            "context_policies": [{"item_id": x} for x in excluded], "manual_memory_ids": pinned})
        version = _make_version(snapshot, excluded, pinned, req.get("note", []), situation=situation, bright=bright,
                                dim=dim, scope=_scope(state), thread_id=_thread(config), turn=i)
        record["versions"] = record["versions"] + [version]
        record["memory_changes"] = (record.get("memory_changes", []) + _tool_changes(version)
                                    + _follow_correction(req, record, situation, config, i))
    latest = record["versions"][-1]
    return {"messages": [AIMessage(content=latest["content"], id=ai.id)],
            "turn_records": {str(i): record},
            "history_lineage": {str(i): latest["lineage"]},
            "regen_request": None}


def _follow_correction(req: dict, record: dict, situation: dict, config: RunnableConfig, turn: int) -> list[dict]:
    """The user corrected what was going on: what this turn wrote keeps the corrected reading."""
    if not req.get("situation"):
        return []
    written = [c["memory_id"] for c in record.get("memory_changes", []) if c["kind"] == "created"]
    source = memory.Source("user", thread_id=_thread(config), turn=turn, reason="corrected what was going on")
    events = memory.operations.relabel(written, situation["doing"], source)
    return [_change(e) for e in records.changes(events)]


def _make_version(snapshot: dict, excluded: list[str], pinned: list[str], note, *, situation, scope, thread_id,
                  turn, bright=(), dim=()) -> dict:
    prompt, question = snapshot["messages"][0]["content"], snapshot["messages"][1]["content"]
    labels = Labels(snapshot.get("labels"))
    with capture_calls() as agent_calls:
        text, steps = engine.answer(prompt, question, situation=situation, scope=scope, thread_id=thread_id, turn=turn,
                                    excluded_files=excluded, labels=labels)
    # Memories the agent looked up itself are sources too.
    recalled = [m["id"] if isinstance(m, dict) else m for s in steps for m in (s["artifact"] or {}).get("memories", [])]
    file_dependencies = list(snapshot.get("file_dependencies", []))
    candidates = {item["id"]: dict(item) for item in snapshot["candidates"]}
    selected = list(snapshot["selected_ids"])
    for doc in (d for step in steps for d in (step["artifact"] or {}).get("documents", [])):
        for dep in doc["files"]:
            if dep not in file_dependencies:
                file_dependencies.append(dep)
        item = candidates.get(doc["id"])
        if item is None:
            candidates[doc["id"]] = {**{k: v for k, v in doc.items() if k != "files"}, "layer": "retrieval", "status": "active",
                                     "selection_reason": {"code": "source"}, "tokens": estimate_tokens(doc["content"])}
            selected.append(doc["id"])
        elif doc["content"] not in item["content"]:
            item["content"] += "\n…\n" + doc["content"]
            item["tokens"] = estimate_tokens(item["content"])
    content, segments = parse_segments(text, [*selected, *recalled], labels)
    return {**({"input_order": snapshot["input_order"]} if "input_order" in snapshot else {}),
            "note": note, "content": content, "segments": segments, "steps": steps, "labels": labels.table,
            "agent_calls": list(agent_calls), "assembled_ids": list(snapshot["selected_ids"]),
            "selected_ids": selected, "candidates": list(candidates.values()),
            "payload": snapshot["messages"], "fingerprint": snapshot["fingerprint"], "situation": situation,
            "concepts": [{"id": c.id, "name": c.name} for c in memory.operations.concepts_named(situation.get("concepts", []))],
            "brighten": list(bright), "dim": list(dim),
            "recalled_ids": sorted(set(recalled)),
            "excluded": excluded, "pinned": pinned, "created_at": datetime.now(timezone.utc).isoformat(),
            "lineage": {"memories": snapshot["memory_dependencies"], "history": snapshot["history_dependencies"],
                        "files": file_dependencies}}


def _tool_changes(version: dict) -> list[dict]:
    return [_change(e) for s in version["steps"] for e in records.changes((s["artifact"] or {}).get("events", []))]


def _change(event: dict) -> dict:
    """What the answer card shows for one memory change; undo goes by event_id."""
    before, after = event["before"] or {}, event["after"] or {}
    return {"event_id": event["id"], "memory_id": event["memory_id"], "kind": event["kind"],
            "actor": event["actor"], "title": after.get("title") or before.get("title"),
            "content": after.get("content"), "previous": before.get("content") if event["kind"] == "revised" else None,
            "reason": event["reason"]}


def _conversation(messages: list[AnyMessage]) -> list[tuple[str, str]]:
    return [("user" if isinstance(m, HumanMessage) else "assistant", str(m.content))
            for m in messages if isinstance(m, (HumanMessage, AIMessage))]


def _scope(state: LensState) -> str:
    return state.get("project_id") or memory.ORDINARY


def _thread(config: RunnableConfig) -> str | None:
    return (config.get("configurable") or {}).get("thread_id")


_builder = StateGraph(LensState)
_builder.add_node("answer", answer_turn)
_builder.add_node("remember", remember_turn)
_builder.add_node("rewrite", rewrite_turn)
_builder.add_conditional_edges(START, lambda s: "rewrite" if s.get("regen_request") else "answer")
_builder.add_edge("answer", "remember")
_builder.add_edge("remember", END)
_builder.add_edge("rewrite", END)
graph = _builder.compile()
