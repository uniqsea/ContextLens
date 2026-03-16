"""Context state schema and context-building helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal, NotRequired, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages

from src.memory import SessionContextMode, list_memories_by_ids, list_memories_for_context

# ---------------------------------------------------------------------------
# Type definitions shared with the frontend canvas
# ---------------------------------------------------------------------------

ContextLayer = Literal["system", "memory", "retrieval", "user"]
ContextStatus = Literal[
    "active",
    "temporarily_ignored",
    "context_blocked",
    "trashed",
]
MemoryType = Literal["semantic", "episodic", "procedural"]
MemoryConfidence = Literal["high", "low"]
ThreadPolicyStatus = Literal["temporarily_ignored"]


class ContextItem(TypedDict):
    id: str
    layer: ContextLayer
    title: str
    content: str
    source_label: str
    source_type: str
    created_at: str
    status: ContextStatus
    is_memory: bool
    memory_type: NotRequired[MemoryType]
    memory_confidence: NotRequired[MemoryConfidence]
    context_scope: NotRequired[SessionContextMode]
    blocked_context_modes: NotRequired[list[SessionContextMode]]
    blocked_in_current_mode: NotRequired[bool]


class ContextGroup(TypedDict):
    id: str
    layer: ContextLayer
    title: str
    x: float
    y: float
    width: float
    height: float


class ContextNoteLayout(TypedDict):
    item_id: str
    group_id: str
    x: float
    y: float


class ContextCanvasView(TypedDict):
    x: float
    y: float
    z: float


class PromptLayer(TypedDict):
    layer: ContextLayer
    item_ids: list[str]


class ContextPolicy(TypedDict):
    item_id: str
    status: ThreadPolicyStatus


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    context_items: NotRequired[list[ContextItem]]
    context_groups: NotRequired[list[ContextGroup]]
    context_note_layouts: NotRequired[list[ContextNoteLayout]]
    context_canvas_view: NotRequired[ContextCanvasView]
    context_policies: NotRequired[list[ContextPolicy]]
    prompt_layers: NotRequired[list[PromptLayer]]
    awaiting_approval: NotRequired[bool]
    session_context_mode: NotRequired[SessionContextMode]
    manual_memory_ids: NotRequired[list[str]]


# ---------------------------------------------------------------------------
# Mock retrieval sources
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are ContextLens, a helpful AI assistant. "
    "Answer the user's questions based on the provided context. "
    "Be concise and informative."
)

RETRIEVAL_LIBRARY = [
    {
        "title": "Contextual Integrity Framework",
        "content": "Nissenbaum's contextual integrity theory posits that privacy is maintained when information flows conform to context-relative informational norms.",
        "source_label": "nissenbaum_2004.pdf",
        "keywords": ["contextual", "integrity", "privacy", "nissenbaum", "norms"],
    },
    {
        "title": "Human-AI Interaction Guidelines",
        "content": "Microsoft's HAX toolkit provides 18 guidelines for human-AI interaction, emphasizing transparency, control, and graceful failure handling.",
        "source_label": "hax_guidelines.pdf",
        "keywords": ["human", "ai", "interaction", "guidelines", "transparency"],
    },
    {
        "title": "Memory-Augmented LLMs",
        "content": "Recent work on memory-augmented language models enables persistent user preferences and conversation history across sessions.",
        "source_label": "mem_augmented_llm.pdf",
        "keywords": ["memory", "llm", "persistent", "conversation", "augmented"],
    },
    {
        "title": "RAG System Architecture",
        "content": "Retrieval-Augmented Generation combines dense retrieval with generative models to ground responses in external knowledge sources.",
        "source_label": "rag_survey_2024.pdf",
        "keywords": ["rag", "retrieval", "generation", "knowledge", "architecture"],
    },
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _retrieve(query: str, top_k: int = 2) -> list[dict]:
    """Simple keyword-based mock retrieval."""
    query_lower = query.lower()
    scored = []
    for doc in RETRIEVAL_LIBRARY:
        score = sum(1 for kw in doc["keywords"] if kw in query_lower)
        if score > 0:
            scored.append((score, doc))
    scored.sort(key=lambda x: -x[0])
    return [doc for _, doc in scored[:top_k]]


def build_context_items(state: AgentState) -> list[ContextItem]:
    """Build the full context snapshot from all sources."""
    items: list[ContextItem] = []
    mode = state.get("session_context_mode", "general")
    temporarily_ignored = {
        p["item_id"]
        for p in (state.get("context_policies") or [])
        if p["status"] == "temporarily_ignored"
    }
    now = _now_iso()

    def _status(item_id: str) -> ContextStatus:
        return "temporarily_ignored" if item_id in temporarily_ignored else "active"

    items.append(
        ContextItem(
            id="sys-001",
            layer="system",
            title="System Prompt",
            content=SYSTEM_PROMPT,
            source_label="Built-in",
            source_type="system",
            created_at=now,
            status=_status("sys-001"),
            is_memory=False,
        )
    )

    records_by_id: dict[str, dict] = {}

    for record in list_memories_for_context(mode):
        records_by_id[record["id"]] = record

    for record in list_memories_by_ids(state.get("manual_memory_ids") or []):
        if record["lifecycle_state"] != "active":
            continue
        records_by_id[record["id"]] = record

    for record in records_by_id.values():
        items.append(
            ContextItem(
                id=record["id"],
                layer="memory",
                title=record["title"],
                content=record["content"],
                source_label=f"Memory · {record['context_scope']}",
                source_type="memory",
                created_at=record["created_at"],
                status=_status(record["id"]),
                is_memory=True,
                memory_type=record["memory_type"],
                memory_confidence=record["confidence"],
                context_scope=record["context_scope"],
                blocked_context_modes=record["blocked_context_modes"],
                blocked_in_current_mode=mode in record["blocked_context_modes"],
            )
        )

    user_query = ""
    if state.get("messages"):
        last_msg = state["messages"][-1]
        if hasattr(last_msg, "content"):
            user_query = str(last_msg.content)

    for i, doc in enumerate(_retrieve(user_query)):
        ret_id = f"ret-{i + 1:03d}"
        items.append(
            ContextItem(
                id=ret_id,
                layer="retrieval",
                title=doc["title"],
                content=doc["content"],
                source_label=doc["source_label"],
                source_type="retrieval",
                created_at=now,
                status=_status(ret_id),
                is_memory=False,
            )
        )

    if user_query:
        items.append(
            ContextItem(
                id="usr-001",
                layer="user",
                title="Current Query",
                content=user_query,
                source_label="User input",
                source_type="user",
                created_at=now,
                status=_status("usr-001"),
                is_memory=False,
            )
        )

    return items


def build_active_prompt(items: list[ContextItem]) -> str:
    """Construct the system prompt string from active context items only."""
    layer_order: list[ContextLayer] = ["system", "memory", "retrieval"]
    sections: list[str] = []

    for layer in layer_order:
        layer_items = [it for it in items if it["layer"] == layer and it["status"] == "active"]
        if not layer_items:
            continue

        if layer == "system":
            sections.append(layer_items[0]["content"])
        elif layer == "memory":
            lines = [
                f"- [{it['memory_type']}/{it['context_scope']}] {it['title']}: {it['content']}"
                for it in layer_items
            ]
            sections.append("## Relevant memories\n" + "\n".join(lines))
        elif layer == "retrieval":
            lines = [f"- [{it['source_label']}] {it['content']}" for it in layer_items]
            sections.append("## Retrieved context\n" + "\n".join(lines))

    return "\n\n".join(sections)


def build_prompt_layers(items: list[ContextItem]) -> list[PromptLayer]:
    layer_order: list[ContextLayer] = ["system", "memory", "retrieval", "user"]
    layers: list[PromptLayer] = []
    for layer in layer_order:
        ids = [it["id"] for it in items if it["layer"] == layer]
        if ids:
            layers.append(PromptLayer(layer=layer, item_ids=ids))
    return layers


# ---------------------------------------------------------------------------
# Canvas layout helpers
# ---------------------------------------------------------------------------

GROUP_WIDTH = 320.0
GROUP_MIN_HEIGHT = 200.0
GROUP_GAP_X = 40.0
GROUP_GAP_Y = 40.0
CARD_HEIGHT = 140.0
CARD_GAP = 16.0
CARD_OFFSET_TOP = 50.0
CARD_OFFSET_LEFT = 30.0


def _group_height(n_items: int) -> float:
    if n_items == 0:
        return GROUP_MIN_HEIGHT
    return CARD_OFFSET_TOP + n_items * (CARD_HEIGHT + CARD_GAP) + CARD_GAP


def build_layout(
    items: list[ContextItem],
    state: AgentState,
) -> tuple[list[ContextGroup], list[ContextNoteLayout], ContextCanvasView]:
    existing_groups = state.get("context_groups")
    existing_layouts = state.get("context_note_layouts")
    existing_view = state.get("context_canvas_view")
    if existing_groups and existing_layouts:
        return existing_groups, existing_layouts, existing_view or _default_view()

    groups: list[ContextGroup] = []
    layouts: list[ContextNoteLayout] = []
    items_by_layer: dict[ContextLayer, list[ContextItem]] = {
        "system": [],
        "memory": [],
        "retrieval": [],
        "user": [],
    }
    for item in items:
        items_by_layer[item["layer"]].append(item)

    sys_height = _group_height(len(items_by_layer["system"]))
    mem_height = _group_height(len(items_by_layer["memory"]))
    row0_max_height = max(sys_height, mem_height)

    groups.append(
        ContextGroup(
            id="group-system",
            layer="system",
            title="System",
            x=0,
            y=0,
            width=GROUP_WIDTH,
            height=sys_height,
        )
    )
    for idx, item in enumerate(items_by_layer["system"]):
        layouts.append(
            ContextNoteLayout(
                item_id=item["id"],
                group_id="group-system",
                x=CARD_OFFSET_LEFT,
                y=CARD_OFFSET_TOP + idx * (CARD_HEIGHT + CARD_GAP),
            )
        )

    mem_x = GROUP_WIDTH + GROUP_GAP_X
    groups.append(
        ContextGroup(
            id="group-memory",
            layer="memory",
            title="Memory",
            x=mem_x,
            y=0,
            width=GROUP_WIDTH,
            height=mem_height,
        )
    )
    for idx, item in enumerate(items_by_layer["memory"]):
        layouts.append(
            ContextNoteLayout(
                item_id=item["id"],
                group_id="group-memory",
                x=CARD_OFFSET_LEFT,
                y=CARD_OFFSET_TOP + idx * (CARD_HEIGHT + CARD_GAP),
            )
        )

    ret_y = row0_max_height + GROUP_GAP_Y
    ret_height = _group_height(len(items_by_layer["retrieval"]))
    groups.append(
        ContextGroup(
            id="group-retrieval",
            layer="retrieval",
            title="Retrieval",
            x=0,
            y=ret_y,
            width=GROUP_WIDTH,
            height=ret_height,
        )
    )
    for idx, item in enumerate(items_by_layer["retrieval"]):
        layouts.append(
            ContextNoteLayout(
                item_id=item["id"],
                group_id="group-retrieval",
                x=CARD_OFFSET_LEFT,
                y=CARD_OFFSET_TOP + idx * (CARD_HEIGHT + CARD_GAP),
            )
        )

    user_x = 2 * (GROUP_WIDTH + GROUP_GAP_X)
    for item in items_by_layer["user"]:
        layouts.append(
            ContextNoteLayout(
                item_id=item["id"],
                group_id="user-flat",
                x=user_x,
                y=0,
            )
        )

    return groups, layouts, existing_view or _default_view()


def _default_view() -> ContextCanvasView:
    return ContextCanvasView(x=0, y=0, z=0.85)
