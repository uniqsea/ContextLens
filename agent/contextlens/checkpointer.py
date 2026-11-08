"""Where the server keeps conversations: LangGraph's own SQLite checkpointer, on disk.

langgraph.json points the server here. The graph stores messages and turn records as
DeltaChannels (graph.py), so a checkpoint holds what that turn added, not the whole conversation
again; clients run each turn with durability "exit", one checkpoint per turn.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from contextlens.config import conversations_path


@asynccontextmanager
async def create():
    path = conversations_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(path)) as saver:
        yield saver
