"""Sentence-level provenance: the model tags sentences with the context ids it relied on.

The model sees short ids made for the turn (m1, f2, t3) rather than the store's own: long random ids
are easy to copy wrong, and a wrong one would silently drop the link. Code hands them out (`Labels`)
and maps every marker back to the store's id before anything is recorded.
"""
from __future__ import annotations

import re

INSTRUCTION = (
    "Each context item above is labelled with an id in square brackets. "
    "After every sentence that relies on a context item, append that id in double brackets, "
    "for example: 'Book a vegetarian place.[[m2]]'. Use several markers when a sentence relies on several items. "
    "Leave sentences that rely on no context item unmarked, and never mention the markers."
)

# Real models sometimes space the brackets ("[ [mem-1] ]"); accept that as the same marker.
_MARKERS = re.compile(r"((?:\s*\[\s*\[[^\[\]]*\]\s*\])+)")
_MARKER = re.compile(r"\[\s*\[([^\[\]]*)\]\s*\]")
_SENTENCE = re.compile(r"(?<=[。！？!?；;\n])|(?<=\.\s)")


_PREFIX = {"memory": "m", "retrieval": "f", "short_term": "t"}


class Labels:
    """The turn's short ids: a table from each short id to the store's id. One per answer version."""

    def __init__(self, table: dict[str, str] | None = None):
        self.table = dict(table or {})
        self._short = {real: short for short, real in self.table.items()}

    def short(self, real: str, layer: str) -> str:
        """The id to show the model, the same every time this source comes up in the turn."""
        if real not in self._short:
            prefix = _PREFIX.get(layer, "s")
            n = 1 + sum(1 for s in self.table if s[:len(prefix)] == prefix and s[len(prefix):].isdigit())
            self.table[f"{prefix}{n}"] = real
            self._short[real] = f"{prefix}{n}"
        return self._short[real]

    def real(self, token: str) -> str:
        """The store's id for a short id; anything else is taken as it is."""
        return self.table.get(token.strip(), token.strip())


def parse_segments(text: str, allowed: list[str], labels: Labels | None = None) -> tuple[str, list[dict]]:
    """Split an answer into sentences with their sources; unknown ids are dropped."""
    known = set(allowed)
    resolve = labels.real if labels else str.strip
    pieces = _MARKERS.split(text)
    segments: list[dict] = []
    for k in range(0, len(pieces), 2):
        marks = pieces[k + 1] if k + 1 < len(pieces) else ""
        ids = [resolve(i) for group in _MARKER.findall(marks) for i in group.split(",")]
        ids = [i for i in dict.fromkeys(ids) if i in known]
        sentences = [s for s in _SENTENCE.split(pieces[k]) if s]
        for j, sentence in enumerate(sentences):
            src = ids if j == len(sentences) - 1 else []
            if segments and not sentence.strip():
                # Line breaks between sentences belong to the sentence before them.
                segments[-1]["text"] += sentence
                segments[-1]["src"] = list(dict.fromkeys(segments[-1]["src"] + src))
            else:
                segments.append({"text": sentence, "src": src})
    return "".join(s["text"] for s in segments), segments
