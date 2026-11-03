"""The agent engine: Deep Agents runs the model/tool loop; ContextLens decides what it sees.

This is the only module that imports deepagents. The rest of the backend talks to it through
`answer(prompt, question)`, so the harness can be swapped without touching context or memory.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import cache

from deepagents import create_deep_agent
from deepagents.profiles import GeneralPurposeSubagentProfile, HarnessProfile, register_harness_profile
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from contextlens import memory, models

# Context reaches the model only through the governed snapshot, so the harness must not add its own
# routes in: no general-purpose subagent (separate context) and no automatic summary of history.
_PROFILE = HarnessProfile(
    general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
    excluded_middleware=frozenset({"SummarizationMiddleware"}),
)


@dataclass
class Request(memory.TurnContext):
    """Per-run context: the system prompt rendered from this turn's snapshot, plus where the run
    belongs (question, scope, situation, thread, turn), which the memory tools use and record."""
    prompt: str = ""


class SnapshotPrompt(AgentMiddleware):
    """Every model call in the run leads with the snapshot's prompt; harness additions follow it."""

    def wrap_model_call(self, request, handler):
        harness = request.system_prompt
        prompt = request.runtime.context.prompt + (f"\n\n{harness}" if harness else "")
        return handler(request.override(system_prompt=prompt))


class SettingsModel(AgentMiddleware):
    """Every model call uses the agent model chosen in settings now, so a change applies to the
    next call without rebuilding the agent (the runtime model selection pattern in the Deep Agents
    docs: https://docs.langchain.com/oss/python/deepagents/models)."""

    def wrap_model_call(self, request, handler):
        return handler(request.override(model=models.chat_model("agent")))


@cache
def build():
    model = models.chat_model("agent")
    provider = model._get_ls_params().get("ls_provider")
    if provider:
        register_harness_profile(provider, _PROFILE)
    return create_deep_agent(model=model, tools=memory.TOOLS, middleware=[SettingsModel(), SnapshotPrompt()],
                             context_schema=Request, name="contextlens-engine")


def answer(prompt: str, question: str, *, situation: dict, scope: str = memory.ORDINARY,
           thread_id: str | None = None, turn: int | None = None, config=None) -> tuple[str, list[dict]]:
    """Run the engine once. Returns the final text and the tool steps taken on the way."""
    result = build().invoke({"messages": [HumanMessage(content=question)]}, config,
                            context=Request(prompt=prompt, question=question, scope=scope, situation=situation,
                                            thread_id=thread_id, turn=turn))
    messages = result["messages"]
    final = next(m for m in reversed(messages) if isinstance(m, AIMessage))
    return str(final.text if hasattr(final, "text") else final.content), _steps(messages)


def _steps(messages) -> list[dict]:
    results = {m.tool_call_id: m for m in messages if isinstance(m, ToolMessage)}
    steps = []
    for m in messages:
        for call in getattr(m, "tool_calls", []) if isinstance(m, AIMessage) else []:
            result = results.get(call["id"])
            steps.append({"tool": call["name"], "args": call["args"],
                          "result": str(result.content) if result else None,
                          "artifact": result.artifact if result else None})
    return steps
