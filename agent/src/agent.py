"""ContextLens LangGraph agent.

Three-node graph:
  prepare_context → await_approval (interrupt) → call_llm

The interrupt gives the frontend time to display the context canvas,
let the user review/edit items, then resume to call the LLM with the
approved context.
"""

from __future__ import annotations

import os
from pathlib import Path

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from dotenv import load_dotenv

from src.context_state import (
    AgentState,
    build_active_prompt,
    build_context_items,
    build_layout,
    build_prompt_layers,
    update_short_term_memory,
)
from src.memory import ensure_memory_store

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
ensure_memory_store()

_llm = ChatOpenAI(
    model=os.environ.get("OPENAI_MODEL", "gpt-5-nano"),
    temperature=0.3,
)


# ---------------------------------------------------------------------------
# Graph nodes
# ---------------------------------------------------------------------------


def prepare_context(state: AgentState) -> dict:
    """Build the context snapshot and sync it to the frontend canvas."""
    updated_turns = update_short_term_memory(state, _llm)
    working_state = {**state, "short_term_turns": updated_turns}
    items = build_context_items(working_state)
    groups, layouts, view = build_layout(items, working_state)

    return {
        "context_items": items,
        "context_groups": groups,
        "context_note_layouts": layouts,
        "context_canvas_view": view,
        "prompt_layers": build_prompt_layers(items),
        "awaiting_approval": True,
        "short_term_turns": updated_turns,
    }


def await_approval(state: AgentState) -> dict:
    """Pause execution until the user confirms the context in the canvas."""
    interrupt("context_ready")
    return {"awaiting_approval": False}


def call_llm(state: AgentState) -> dict:
    """Invoke the LLM using only active context items."""
    items = state.get("context_items") or []
    system_prompt = build_active_prompt(items)
    messages = [SystemMessage(content=system_prompt)] + list(state["messages"])
    response = _llm.invoke(messages)
    return {"messages": [response]}


# ---------------------------------------------------------------------------
# Graph assembly
# ---------------------------------------------------------------------------

workflow = StateGraph(AgentState)

workflow.add_node("prepare_context", prepare_context)
workflow.add_node("await_approval", await_approval)
workflow.add_node("call_llm", call_llm)

workflow.add_edge(START, "prepare_context")
workflow.add_edge("prepare_context", "await_approval")
workflow.add_edge("await_approval", "call_llm")
workflow.add_edge("call_llm", END)

graph = workflow.compile()
