"""Shared test fixtures: a throwaway store and a scripted model that records what it was sent."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from contextlens import memory, models

USER = memory.Source("user")
QUESTION = "Plan the team dinner budget"


def _no_model(role: str):
    raise models.NotConfigured(role)


class ScriptedModel(BaseChatModel):
    """Replies with the given texts (or messages, e.g. tool calls) in order and keeps every request."""

    replies: list
    calls: list = []

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.calls.append(messages)
        reply = self.replies.pop(0)
        message = reply if isinstance(reply, AIMessage) else AIMessage(content=reply)
        return ChatResult(generations=[ChatGeneration(message=message)])


def structured(name: str, **args) -> AIMessage:
    """A model reply that fills in a structured-output schema (called through function calling)."""
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": f"call-{name}"}])


def reading(doing: str, scenes=(), concepts=(), new_scene=None) -> AIMessage:
    return structured("Reading", doing=doing, scenes=list(scenes), concepts=list(concepts), new_scene=new_scene)


class StoreTestCase(unittest.TestCase):
    """Each test gets its own empty SQLite file."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        os.environ["CONTEXTLENS_DB_PATH"] = str(Path(self._tmp.name) / "test.sqlite3")
        os.environ["CONTEXTLENS_SEED_PATH"] = str(Path(self._tmp.name) / "no-seeds.json")
        Path(os.environ["CONTEXTLENS_SEED_PATH"]).write_text("[]")
        models.use(_no_model)  # no real settings or embedding model unless a test scripts one

    def tearDown(self):
        models.use(None)
        os.environ.pop("CONTEXTLENS_DB_PATH", None)
        os.environ.pop("CONTEXTLENS_SEED_PATH", None)
        self._tmp.cleanup()

    def script(self, *replies, memory: list | None = None) -> ScriptedModel:
        """The agent replies with `replies`; the memory role replies with `memory`."""
        agent = ScriptedModel(replies=list(replies), calls=[])
        self.memory_model = ScriptedModel(replies=memory or [], calls=[])
        models.use(lambda role: self.memory_model if role == "memory" else agent)
        return agent

    def add_examples(self) -> dict[str, str]:
        """A work fact, a personal fact and a general one; QUESTION finds only the first."""
        self.script()
        return {"work": self.add("WORK_SECRET: the team dinner budget is 150 per person", scenes=["工作"]),
                "personal": self.add("PERSONAL_SECRET: weekend hiking with family", scenes=["生活"]),
                "general": self.add("GENERAL_FACT: prefers concise replies")}

    def add(self, learned: str, **fields) -> str:
        """Add a memory; returns its id."""
        return memory.operations.add_memory(learned, USER, **fields)[-1]["entity_id"]
