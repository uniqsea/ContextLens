"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Hint } from "@/components/ui/tooltip";
import { MemoryApiError, memoryApi } from "@/lib/memory-api";
import type { MemoryChange } from "@/lib/memory-types";
import { Button } from "@/components/ui/button";
import { Undo2 } from "lucide-react";

const FOLDED = 3;

/** Which of a turn's memory changes have been undone, and the undoing: shared by every place that
 * lists them, so one undo shows in all. */
export function useMemoryUndo(
	changes: MemoryChange[],
	threadId: string | null,
	onChanged: () => void,
) {
	const t = useTranslations("memory");
	const [undone, setUndone] = useState<Set<number>>(new Set());
	const [busy, setBusy] = useState<number | null>(null);
	const [error, setError] = useState("");

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
	return { undone, busy, error, undo };
}
export type MemoryUndo = ReturnType<typeof useMemoryUndo>;

/** One memory change as a small block: what was done, and by whom, on its head line beside its undo;
 * the change itself beneath. The answer, the writing step's card and its details all list them so. */
export function ChangeItem({
	change: c,
	undoing,
	clamp = false,
	showActor = true,
}: {
	change: MemoryChange;
	undoing?: MemoryUndo;
	/** On a card: the change in at most two lines. */
	clamp?: boolean;
	/** Off where every change has the same author, as on the writing step. */
	showActor?: boolean;
}) {
	const t = useTranslations("memory");
	const done = undoing?.undone.has(c.event_id);
	const body = c.kind === "trashed" ? c.title : c.content || c.title;
	return (
		<li
			className="mem-change"
			data-undone={done || undefined}
			data-clamp={clamp || undefined}
		>
			<header>
				<b>{t(`verb.${c.kind}`)}</b>
				{showActor && <small>{t(`actor.${c.actor}`)}</small>}
				{undoing &&
					(done ? (
						<span className="mem-done">{t("undone")}</span>
					) : (
						<Hint label={c.reason ? t("why", { reason: c.reason }) : undefined}>
							<Button
								variant="quiet"
								size="xs"
								type="button"
								className="mem-undo"
								disabled={undoing.busy !== null}
								onClick={() => void undoing.undo(c)}
							>
								<Undo2 />
								{t("undo")}
							</Button>
						</Hint>
					))}
			</header>
			{body && <p>{body}</p>}
			{c.previous && (
				<p className="mem-was">{t("replaced", { previous: c.previous })}</p>
			)}
		</li>
	);
}

/** Under the answer that caused them: every memory change the turn made, by the agent during the
 * task or by the upkeep after it, each one undoable on the spot. */
export function MemoryChanges({
	changes,
	undoing,
}: {
	changes: MemoryChange[];
	undoing: MemoryUndo;
}) {
	const t = useTranslations("memory");
	const [expanded, setExpanded] = useState(false);

	if (changes.length === 0) return null;

	return (
		<section className="lens-mem" aria-label={t("changesLabel")}>
			<ul className="mem-changes">
				{(expanded ? changes : changes.slice(0, FOLDED)).map((c) => (
					<ChangeItem key={c.event_id} change={c} undoing={undoing} />
				))}
			</ul>
			{changes.length > FOLDED && (
				<Button
					variant="quiet"
					size="sm"
					type="button"
					className="lens-mem-more"
					aria-expanded={expanded}
					onClick={() => setExpanded((e) => !e)}
				>
					{expanded
						? t("fewer")
						: t("more", { count: changes.length - FOLDED })}
				</Button>
			)}
			{undoing.error && (
				<p role="alert" className="err">
					{undoing.error}
				</p>
			)}
		</section>
	);
}
