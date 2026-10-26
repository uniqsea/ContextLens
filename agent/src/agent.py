"""Preview → confirm → revalidate → answer, with durable request evidence."""
from __future__ import annotations
import os
from pathlib import Path
from dotenv import load_dotenv
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from src.context_state import AgentState, build_layout, build_prompt_layers, _parse_turns_from_messages
from src.context_control import prepare_snapshot, as_messages

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
# Request evidence remains local unless tracing is explicitly opted into.
if os.environ.get("CONTEXTLENS_ALLOW_TRACING") != "1":
    os.environ["LANGCHAIN_TRACING_V2"] = "false"
    os.environ["LANGSMITH_TRACING"] = "false"


def prepare_context(state):
    items, snapshot = prepare_snapshot(state)
    groups, layouts, view = build_layout(items, {})
    return {"context_items": items, "context_snapshot": snapshot,
            "context_groups": groups, "context_note_layouts": layouts,
            "context_canvas_view": state.get("context_canvas_view", view),
            "prompt_layers": build_prompt_layers(items), "awaiting_approval": True,
            "approval_valid": False}


def await_approval(state):
    interrupt({"type": "context_ready", "fingerprint": state["context_snapshot"]["fingerprint"]})
    _, current = prepare_snapshot(state)
    valid = current["fingerprint"] == state["context_snapshot"]["fingerprint"]
    return {"approval_valid": valid, "awaiting_approval": not valid,
            "approval_notice": "" if valid else "Context changed. Review the refreshed preview and confirm again."}


def invoke_model(messages):
    if os.environ.get("CONTEXTLENS_MOCK") == "1":
        from langchain_core.messages import AIMessage
        return AIMessage(content="[MOCK — no provider call] Request captured. Inspect submitted context below.")
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(model=os.environ.get("OPENAI_MODEL", "gpt-5-nano"), temperature=0.3).invoke(messages)


def call_llm(state):
    _, current = prepare_snapshot(state)
    if current["fingerprint"] != state["context_snapshot"]["fingerprint"]:
        return {"approval_valid": False, "approval_notice": "Memory changed before sending. Review again."}
    response = invoke_model(as_messages(current))
    index = len(_parse_turns_from_messages(state.get("messages", [])))
    lineage = dict(state.get("history_lineage", {}))
    lineage[str(index)] = {"mode": current["mode"], "memories": current["memory_dependencies"],
                           "history": current["history_dependencies"]}
    return {"messages": [response], "last_request": current, "history_lineage": lineage,
            "context_policies": [], "manual_memory_ids": [], "context_items": [],
            "awaiting_approval": False, "approval_valid": True}

workflow = StateGraph(AgentState)
workflow.add_node("prepare_context", prepare_context)
workflow.add_node("await_approval", await_approval)
workflow.add_node("call_llm", call_llm)
workflow.add_edge(START, "prepare_context")
workflow.add_edge("prepare_context", "await_approval")
workflow.add_conditional_edges("await_approval", lambda s: "call_llm" if s.get("approval_valid") else "prepare_context")
workflow.add_conditional_edges("call_llm", lambda s: END if s.get("approval_valid") else "prepare_context")
graph = workflow.compile()
