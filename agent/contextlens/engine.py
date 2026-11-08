"""The agent engine: Deep Agents runs the model/tool loop; ContextLens decides what it sees.

This is the only module that imports deepagents. The rest of the backend talks to it through
`answer(prompt, question)`, so the harness can be swapped without touching context or memory.
"""
from __future__ import annotations

from functools import cache

from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend
from deepagents.profiles import GeneralPurposeSubagentProfile, HarnessProfile, register_harness_profile
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from contextlens import memory, models
from contextlens.project_files.backend import MOUNT, FileCitations, ProjectFiles
from contextlens.provenance import Labels
from contextlens.turn import Request

# Context reaches the model only through the governed snapshot, so the harness must not add its own
# routes in: no general-purpose subagent (separate context) and no automatic summary of history.
_PROFILE = HarnessProfile(
    general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
    excluded_middleware=frozenset({"SummarizationMiddleware"}),
)


class SnapshotPrompt(AgentMiddleware):
    """Every model call in the run leads with the snapshot's prompt; harness additions follow it."""

    def wrap_model_call(self, request, handler):
        harness = request.system_prompt
        prompt = request.runtime.context.prompt + (f"\n\n{harness}" if harness else "")
        return handler(request.override(system_prompt=prompt))


class ReadOnlyFiles(AgentMiddleware):
    """The agent reads files and never changes them: the tools that write are not offered at all."""

    HIDDEN = frozenset({"write_file", "edit_file", "delete"})

    def wrap_model_call(self, request, handler):
        tools = [t for t in request.tools if (t.get("name") if isinstance(t, dict) else t.name) not in self.HIDDEN]
        return handler(request.override(tools=tools))


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
    # Deep Agents' file tools: the project's folders under /projects/, read only; anything else is
    # the harness's own scratch space for the run (large tool results it sets aside, for one).
    backend = CompositeBackend(default=StateBackend(), routes={MOUNT: ProjectFiles()})
    # Never saved: a run lives for one answer, and the turn record keeps what it did. Without this
    # the run would take on the app graph's checkpointer and save every step into the conversation.
    return create_deep_agent(model=model, tools=memory.TOOLS, backend=backend,
                             middleware=[SettingsModel(), SnapshotPrompt(), ReadOnlyFiles(), FileCitations()],
                             context_schema=Request, name="contextlens-engine", checkpointer=False)


def answer(prompt: str, question: str, *, situation: dict, scope: str = memory.ORDINARY,
           thread_id: str | None = None, turn: int | None = None, config=None, excluded_files=(),
           labels: Labels | None = None) -> tuple[str, list[dict]]:
    """Run the engine once. Returns the final text and the tool steps taken on the way. `labels` is the
    turn's table of short ids; sources the agent comes across on the way are added to it."""
    result = build().invoke({"messages": [HumanMessage(content=question)]}, config,
                            context=Request(prompt=prompt, question=question, scope=scope, situation=situation,
                                            thread_id=thread_id, turn=turn, excluded_files=set(excluded_files),
                                            labels=labels if labels is not None else Labels()))
    messages = result["messages"]
    final = next(m for m in reversed(messages) if isinstance(m, AIMessage))
    return str(final.text if hasattr(final, "text") else final.content), _steps(messages)


def _steps(messages) -> list[dict]:
    results = {m.tool_call_id: m for m in messages if isinstance(m, ToolMessage)}
    steps = []
    for m in messages:
        for call in getattr(m, "tool_calls", []) if isinstance(m, AIMessage) else []:
            result = results.get(call["id"])
            steps.append({"call_id": call["id"], "tool": call["name"], "args": call["args"],
                          "result": str(result.content) if result else None,
                          "artifact": result.artifact if result else None})
    return steps
