"use client";

import { Check, Pin } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Hint } from "@/components/ui/tooltip";
import type { MemoryRecord } from "@/lib/memory-types";

const ACTORS = new Set(["user", "agent", "consolidation", "import"]);

/** A memory's type and author, in words. */
export function useMemoryLabels(m: MemoryRecord | undefined) {
	const t = useTranslations("library");
	const ta = useTranslations("memory");
	if (!m) return { type: "", source: "" };
	const actor = ACTORS.has(m.source_kind)
		? ta(`actor.${m.source_kind}` as "actor.user")
		: m.source_kind;
	return {
		type: t.has(`memoryTypes.${m.memory_type}` as "memoryTypes.semantic")
			? t(`memoryTypes.${m.memory_type}` as "memoryTypes.semantic")
			: m.memory_type,
		source: t("source", { actor }),
	};
}

/** One memory in the gallery: what it says, then one quiet line of facts about it. Everything you
 * can do to it is one click away, in its details. While splitting a concept, a click ticks it. */
export function MemoryCard({
	memory: m,
	owner,
	picking,
	picked,
	onOpen,
	onPick,
}: {
	memory: MemoryRecord;
	owner: string;
	picking: boolean;
	picked: boolean;
	onOpen: () => void;
	onPick: () => void;
}) {
	const t = useTranslations("library");
	const { type, source } = useMemoryLabels(m);
	const format = useFormatter();
	return (
		<button
			type="button"
			className={`lib-card${m.lifecycle_state === "trashed" ? " is-trashed" : ""}`}
			aria-pressed={picking ? picked : undefined}
			onClick={picking ? onPick : onOpen}
		>
			{picking ? (
				<span className="lib-card-pick" aria-hidden="true">
					<Check />
				</span>
			) : (
				m.always_on && (
					<Hint label={t("alwaysOn")}>
						<span className="lib-card-mark">
							<Pin aria-label={t("alwaysOn")} />
						</span>
					</Hint>
				)
			)}
			<h2>{m.title}</h2>
			<p>{m.content}</p>
			<div className="lib-meta">
				<i aria-hidden="true" />
				<span>{owner}</span>
				<span>{type}</span>
				{m.scenes.map((scene) => (
					<span key={scene}>{scene}</span>
				))}
				{m.concepts.map((c) => (
					<span key={c.id}>{c.name}</span>
				))}
				{m.due && <span className="lib-due">{t("maybeStale")}</span>}
				<span>{source}</span>
				<span className={m.uses ? "lib-used" : undefined}>
					{m.uses && m.last_used
						? t("used", {
								count: m.uses,
								date: format.dateTime(new Date(m.last_used), {
									month: "short",
									day: "numeric",
								}),
							})
						: t("unused")}
				</span>
			</div>
		</button>
	);
}
