"""Context shared by the agent harness and its scoped tools for a single turn."""
from dataclasses import dataclass, field

from contextlens.memory import TurnContext


@dataclass
class Request(TurnContext):
    """Per-run context: the system prompt rendered from this turn's snapshot, plus where the run
    belongs (question, scope, situation, thread, turn), which the memory tools use and record."""
    prompt: str = ""
    excluded_files: set[str] = field(default_factory=set)
