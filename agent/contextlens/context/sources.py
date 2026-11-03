"""Context that is not long-term memory: documents and the conversation so far."""
from __future__ import annotations

from langchain_core.messages import AIMessage, AnyMessage, HumanMessage

# Stand-in document store until real ingestion lands; ids stay stable across queries.
DOCUMENTS = [
    {"id": "doc-team-dinner-policy", "title": "团建报销规定.pdf · 第 3 页",
     "content": "团队聚餐须在工作日 21:00 前结束，人均超出预算的部分不予报销。",
     "source_label": "团建报销规定.pdf", "keywords": ["聚餐", "团建", "报销", "晚餐"]},
    {"id": "doc-contextual-integrity", "title": "Contextual Integrity Framework",
     "content": "Nissenbaum's contextual integrity theory posits that privacy is maintained when information "
                "flows conform to context-relative informational norms.",
     "source_label": "nissenbaum_2004.pdf", "keywords": ["contextual", "integrity", "privacy", "nissenbaum", "norms"]},
    {"id": "doc-hax-guidelines", "title": "Human-AI Interaction Guidelines",
     "content": "Microsoft's HAX toolkit provides 18 guidelines for human-AI interaction, emphasizing "
                "transparency, control, and graceful failure handling.",
     "source_label": "hax_guidelines.pdf", "keywords": ["human", "ai", "interaction", "guidelines", "transparency"]},
    {"id": "doc-rag-survey", "title": "RAG System Architecture",
     "content": "Retrieval-Augmented Generation combines dense retrieval with generative models to ground "
                "responses in external knowledge sources.",
     "source_label": "rag_survey_2024.pdf", "keywords": ["rag", "retrieval", "generation", "knowledge", "architecture"]},
]


def search_documents(query: str, top_k: int = 2) -> list[dict]:
    """Keyword match against the stand-in document store."""
    q = query.lower()
    scored = [(sum(kw in q for kw in doc["keywords"]), doc) for doc in DOCUMENTS]
    return [doc for score, doc in sorted(scored, key=lambda x: -x[0]) if score][:top_k]


def message_pairs(messages: list[AnyMessage]) -> list[tuple[HumanMessage, AIMessage]]:
    """Complete question/answer pairs, in order."""
    pairs, pending = [], None
    for msg in messages:
        if isinstance(msg, HumanMessage):
            pending = msg
        elif isinstance(msg, AIMessage) and pending is not None:
            pairs.append((pending, msg))
            pending = None
    return pairs


def current_question(messages: list[AnyMessage]) -> str:
    return str(messages[-1].content) if messages and isinstance(messages[-1], HumanMessage) else ""
