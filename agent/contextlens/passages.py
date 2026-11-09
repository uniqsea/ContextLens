"""Splitting text into passages for search: LlamaIndex's sentence splitter, shared by project files and
conversation history. Chinese and English sentence ends both count; a passage is about 512 tokens."""
from __future__ import annotations

import re
from functools import cache

import tiktoken
from llama_index.core.node_parser import SentenceSplitter

PASSAGE_TOKENS, OVERLAP_TOKENS = 512, 64
_HAN = re.compile(r"[\u3400-\u9fff]+")


@cache
def _splitter() -> SentenceSplitter:
    try:
        encoding = tiktoken.get_encoding("o200k_base")
        count = lambda text: encoding.encode(text, disallowed_special=())  # noqa: E731
    except Exception:  # no encoding file and no network: count characters
        count = list
    return SentenceSplitter(chunk_size=PASSAGE_TOKENS, chunk_overlap=OVERLAP_TOKENS, tokenizer=count)


def split(text: str) -> list[str]:
    return _splitter().split_text(text) if text.strip() else []


def terms(text: str) -> str:
    """The words FTS5 indexes for a passage: its own text, with Chinese runs cut into jieba words
    (FTS5 finds Latin word boundaries itself)."""
    from contextlens.memory.search import tokens

    return _HAN.sub(lambda m: " " + " ".join(tokens(m[0])) + " ", text.replace("_", " "))
