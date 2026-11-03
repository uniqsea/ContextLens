"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import type { Candidate, Change, Layer } from "./types";

type Item = Pick<Candidate, "id" | "layer" | "title">;

/**
 * Words for things the agent sends as data: layers, built-in item titles,
 * selection reasons and rewrite notes. User content (memory titles) passes through.
 */
export function useLensText() {
	const t = useTranslations();
	const format = useFormatter();
	const locale = useLocale();
	return useMemo(() => {
		// A joined list of changes reads as one sentence.
		const sentence = (s: string) =>
			s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
		const layer = (l: Layer) => t(`layers.${l}`);
		const title = (c: Item) => {
			if (c.layer === "system") return t("items.system");
			if (c.layer === "user") return t("items.question");
			if (c.id.startsWith("st-"))
				return t("items.turn", { n: Number(c.id.slice(3)) + 1 });
			if (c.id.startsWith("summary-")) return t("items.summary");
			return c.title;
		};
		const reason = (c: Candidate) => {
			const r = c.selection_reason as Candidate["selection_reason"] | string;
			if (typeof r === "string") return r;
			const { code } = r;
			return t.has(`reasons.${code}` as "reasons.query")
				? t(`reasons.${code}` as "reasons.query")
				: code;
		};
		const note = (changes: Change[] | string, candidates: Item[]) =>
			// Threads recorded before notes became structured stored prose.
			typeof changes === "string"
				? changes
				: sentence(
						format.list(
							changes.map((ch) => {
								const c = candidates.find((x) => x.id === ch.id);
								const name = ch.name ?? (c ? title(c) : ch.id);
								return t(`changes.${ch.op}`, { title: name });
							}),
							{ type: "conjunction" },
						),
					);
		return { t, layer, title, reason, note };
	}, [t, format, locale]);
}
