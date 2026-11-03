"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { MemoryApiError, memoryApi } from "@/lib/memory-api";
import type { MemoryChange } from "@/lib/memory-types";

const FOLDED = 3;

/** "Remembered: …  Undo" under the answer that caused it: every memory change the turn made, by the
 * agent during the task or by the upkeep after it, each one undoable on the spot. */
export function MemoryChanges({
	changes,
	threadId,
	onChanged,
}: {
	changes: MemoryChange[];
	threadId: string | null;
	onChanged: () => void;
}) {
	const t = useTranslations("memory");
	const [undone, setUndone] = useState<Set<number>>(new Set());
	const [busy, setBusy] = useState<number | null>(null);
	const [error, setError] = useState("");
	const [expanded, setExpanded] = useState(false);

	// Changes undone earlier (here or in the library) stay marked after a reload.
	useEffect(() => {
		if (!threadId || changes.length === 0) return;
		let live = true;
		memoryApi
			.events({ threadId, limit: 500 })
			.then((events) => {
				if (live)
					setUndone(
						new Set(events.filter((e) => e.reverted_by).map((e) => e.id)),
					);
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [threadId, changes.length]);

	if (changes.length === 0) return null;

	const undo = async (c: MemoryChange) => {
		setBusy(c.event_id);
		setError("");
		try {
			await memoryApi.revert(c.event_id);
			setUndone((s) => new Set(s).add(c.event_id));
			onChanged();
		} catch (e) {
			setError(
				t("undoFailed", {
					message: e instanceof MemoryApiError ? e.message : "",
				}),
			);
		} finally {
			setBusy(null);
		}
	};

	return (
		<section className="lens-mem" aria-label={t("changesLabel")}>
			{(expanded ? changes : changes.slice(0, FOLDED)).map((c) => (
				<div
					key={c.event_id}
					className={`lens-mem-row${undone.has(c.event_id) ? " undone" : ""}`}
				>
					<span className="who">{t(`actor.${c.actor}`)}</span>
					<span className="what">
						<b>{t(`verb.${c.kind}`)}</b> {c.title}
						{c.content && c.kind !== "trashed" && (
							<span className="body">{c.content}</span>
						)}
						{c.previous && (
							<span className="was">
								{t("replaced", { previous: c.previous })}
							</span>
						)}
					</span>
					{undone.has(c.event_id) ? (
						<span className="done">{t("undone")}</span>
					) : (
						<button
							type="button"
							disabled={busy !== null}
							onClick={() => void undo(c)}
							title={c.reason ? t("why", { reason: c.reason }) : undefined}
						>
							{t("undo")}
						</button>
					)}
				</div>
			))}
			{changes.length > FOLDED && (
				<button
					type="button"
					className="lens-mem-more"
					aria-expanded={expanded}
					onClick={() => setExpanded((e) => !e)}
				>
					{expanded
						? t("fewer")
						: t("more", { count: changes.length - FOLDED })}
				</button>
			)}
			{error && (
				<p role="alert" className="err">
					{error}
				</p>
			)}
		</section>
	);
}
