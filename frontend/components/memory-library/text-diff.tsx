"use client";

import { diffArrays } from "diff";
import { useMemo } from "react";

/** Word-level difference between two versions of a memory. Words come from Intl.Segmenter, so
 * Chinese (no spaces), English and mixed text all split where a reader would expect. */
export function TextDiff({ before, after }: { before: string; after: string }) {
	const parts = useMemo(
		() => diffArrays(words(before), words(after)),
		[before, after],
	);
	return (
		<p className="tl-diff">
			{parts.map((part, i) => {
				const text = part.value.join("");
				const key = `${i}:${part.added ? "+" : part.removed ? "-" : "="}`;
				if (part.added) return <ins key={key}>{text}</ins>;
				if (part.removed) return <del key={key}>{text}</del>;
				return <span key={key}>{text}</span>;
			})}
		</p>
	);
}

const segmenter =
	typeof Intl !== "undefined" && "Segmenter" in Intl
		? new Intl.Segmenter(undefined, { granularity: "word" })
		: null;

function words(text: string): string[] {
	if (!segmenter) return Array.from(text);
	return Array.from(segmenter.segment(text), (s) => s.segment);
}
