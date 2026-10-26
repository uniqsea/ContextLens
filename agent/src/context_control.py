"""Canonical, inspectable context selection. No model calls during preview."""
from __future__ import annotations

import hashlib
import json
from langchain_core.messages import HumanMessage, SystemMessage
from src.context_state import build_context_items, build_active_prompt, _parse_turns_from_messages
from src.memory.repository import list_memories
from src.selection import select_memories

MODES = {"study", "work", "personal", "life", "general"}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def memory_stamp(record):
    return digest({key: record[key] for key in (
        "id", "revision", "content", "title", "context_scope", "lifecycle_state", "blocked_context_modes"
    )})


def prepare_snapshot(state):
    mode = state.get("session_context_mode", "general")
    if mode not in MODES:
        raise ValueError("Unknown context mode")
    records = list_memories(include_trashed=True)
    by_id = {r["id"]: r for r in records}
    ignored = {p["item_id"] for p in state.get("context_policies", [])}
    edits = {it["id"]: it for it in state.get("context_items", [])}
    # Status edits are request-local; persistent rules are always checked below.
    ignored |= {it["id"] for it in edits.values() if it.get("status") == "temporarily_ignored"}
    manual = set(state.get("manual_memory_ids", []))
    turns = _parse_turns_from_messages(state.get("messages", []))
    lineage = state.get("history_lineage", {})
    rejected_turns = set()
    raw = []
    for i, (human, ai) in enumerate(turns):
        meta = lineage.get(str(i))
        valid = bool(meta) and meta["mode"] == mode
        if valid:
            valid = all(mid in by_id and memory_stamp(by_id[mid]) == stamp
                        and mid not in ignored and by_id[mid]["lifecycle_state"] == "active"
                        and mode not in by_id[mid]["blocked_context_modes"]
                        for mid, stamp in meta["memories"].items())
            valid = valid and not any(j in rejected_turns or f"st-{j:04d}" in ignored
                                      for j in meta.get("history", []))
        if not valid or f"st-{i:04d}" in ignored:
            rejected_turns.add(i)
        raw.append({"turn_index": i, "human": human, "ai": ai, "is_summary": False})
    working = {**state, "short_term_turns": raw}
    items = [it for it in build_context_items(working) if it["layer"] != "memory"]
    for it in items:
        old = edits.get(it["id"])
        if old and it["layer"] in ("system", "retrieval", "user"):
            it["content"] = old["content"]
        it["status"] = "temporarily_ignored" if it["id"] in ignored else "active"
        it["selection_reason"] = "Current request" if it["layer"] == "user" else "Context source"
        if it["layer"] == "short_term":
            index = int(it["id"][3:])
            if index in rejected_turns:
                it["status"] = "temporarily_ignored"
                it["selection_reason"] = "Excluded: request choice, changed context, or stale dependencies"
            else:
                it["selection_reason"] = "Same context; source versions still valid"
            it["source_revision"] = digest([turns[index], lineage.get(str(index))])
    query_text = next((it["content"] for it in items if it["layer"] == "user"), "")
    retrieved = select_memories(records, query_text, mode, manual=manual, ignored=ignored)
    for r in records:
        if r["lifecycle_state"] == "trashed":
            status, reason = "trashed", "In trash"
        elif mode in r["blocked_context_modes"]:
            status, reason = "context_blocked", "Blocked in this context; unblock before adding"
        elif r["id"] in ignored:
            status, reason = "temporarily_ignored", "Excluded for this request only"
        elif r["context_scope"] not in (mode, "general") and r["id"] not in manual:
            status, reason = "context_blocked", "Other context; explicit addition required"
        elif r["id"] not in retrieved:
            status, reason = "context_blocked", "Outside retrieval rank or 4,000-character memory budget"
        else:
            status = "active"
            reason = "Explicit addition" if r["id"] in manual else "Current or general context"
        items.append(dict(id=r["id"], layer="memory", title=r["title"], content=r["content"],
                          source_label=r["source_kind"], source_type="memory", created_at=r["created_at"],
                          status=status, is_memory=True, memory_type=r["memory_type"],
                          context_scope=r["context_scope"], revision=r["revision"],
                          blocked_context_modes=r["blocked_context_modes"],
                          selection_reason=reason))
    # Extractive summary: deterministic, no hidden pre-approval provider request.
    # Dependencies reference canonical raw history, never an earlier summary.
    allowed = [it for it in items if it["layer"] == "short_term" and it["status"] == "active"]
    summary_dependencies = []
    if len(allowed) > 20:
        compressed = allowed[:-6]
        summary_dependencies = [{"id": it["id"], "revision": it["source_revision"]} for it in compressed]
        sid = "summary-" + digest(summary_dependencies)[:16]
        items = [it for it in items if it not in compressed]
        items.append(dict(id=sid, layer="short_term", title="Extractive history summary",
                          content="\n".join(it["content"][:400] for it in compressed),
                          source_label="Extractive excerpts (up to 400 characters per turn)",
                          source_type="summary", created_at="", is_memory=False,
                          status="temporarily_ignored" if sid in ignored else "active",
                          selection_reason="Rebuilt from permitted history only",
                          dependencies=summary_dependencies))
    selected = [it for it in items if it["status"] == "active"]
    query = next((it["content"] for it in selected if it["layer"] == "user"), "")
    messages = [{"role": "system", "content": build_active_prompt(selected)},
                {"role": "user", "content": query}]
    snapshot = {"mode": mode, "candidates": [
        {k: it.get(k) for k in ("id", "layer", "title", "content", "revision", "status", "selection_reason")}
        for it in items], "selected_ids": [it["id"] for it in selected],
        "messages": messages, "summary_dependencies": summary_dependencies,
        "memory_dependencies": {it["id"]: memory_stamp(by_id[it["id"]]) for it in selected if it["layer"] == "memory"},
        "history_dependencies": [i for i in range(len(turns)) if i not in rejected_turns]}
    snapshot["fingerprint"] = digest(snapshot)
    return items, snapshot


def as_messages(snapshot):
    return [SystemMessage(content=snapshot["messages"][0]["content"]),
            HumanMessage(content=snapshot["messages"][1]["content"])]
