"""Sentence-level provenance: the model tags sentences with the context ids it relied on."""
from __future__ import annotations

import re

INSTRUCTION = (
    "Each context item above is labelled with an id in square brackets. "
    "After every sentence that relies on a context item, append that id in double brackets, "
    "for example: 'Book a vegetarian place.[[mem-002]]'. Use several markers when a sentence relies on several items. "
    "Leave sentences that rely on no context item unmarked, and never mention the markers."
)

# Real models sometimes space the brackets ("[ [mem-1] ]"); accept that as the same marker.
_MARKERS = re.compile(r"((?:\s*\[\s*\[[^\[\]]*\]\s*\])+)")
_MARKER = re.compile(r"\[\s*\[([^\[\]]*)\]\s*\]")
_SENTENCE = re.compile(r"(?<=[。！？!?；;\n])|(?<=\.\s)")


def parse_segments(text: str, allowed: list[str]) -> tuple[str, list[dict]]:
    """Split an answer into sentences with their sources; unknown ids are dropped."""
    known = set(allowed)
    pieces = _MARKERS.split(text)
    segments: list[dict] = []
    for k in range(0, len(pieces), 2):
        marks = pieces[k + 1] if k + 1 < len(pieces) else ""
        ids = [i.strip() for group in _MARKER.findall(marks) for i in group.split(",")]
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
