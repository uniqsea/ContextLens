"""Local turn evidence. Capture chat messages at the model boundary, after prompt middleware.

Only conversational text, tool requests/results and tool definitions belong in a turn card.
Provider settings, headers, reasoning blocks and the surrounding runtime never enter the record.
"""
from contextlib import contextmanager
from contextvars import ContextVar

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.tracers.context import register_configure_hook


def _message(message):
    role = {"human": "user", "ai": "assistant"}.get(message.type, message.type)
    row = {"role": role, "content": message.text}
    if calls := getattr(message, "tool_calls", None):
        row["tool_calls"] = [{k: c[k] for k in ("id", "name", "args") if k in c} for c in calls]
    if tool_call_id := getattr(message, "tool_call_id", None):
        row["tool_call_id"] = tool_call_id
    return row


class _Calls(BaseCallbackHandler):
    def __init__(self):
        self.calls = {}

    def on_chat_model_start(self, serialized, messages, *, run_id, invocation_params=None, **kwargs):
        call = {"messages": [_message(m) for m in messages[0]]}
        # Model constructors can carry credentials. Only the bound tool definitions are relevant here.
        tools = (invocation_params or {}).get("tools", [])
        if tools:
            call["tools"] = [t for t in tools if isinstance(t, dict)]
        self.calls[run_id] = call

    def on_llm_end(self, response, *, run_id, **kwargs):
        if run_id in self.calls and response.generations and response.generations[0]:
            self.calls[run_id]["output"] = _message(response.generations[0][0].message)

    def on_llm_error(self, error, *, run_id, **kwargs):
        if run_id in self.calls:
            self.calls[run_id]["failed"] = True


_current = ContextVar("contextlens_turn_calls", default=None)
register_configure_hook(_current, inheritable=False)


@contextmanager
def capture_calls():
    collector = _Calls()
    token = _current.set(collector)
    try:
        yield collector.calls.values()
    finally:
        _current.reset(token)
