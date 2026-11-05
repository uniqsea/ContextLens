"use client";

import {
	Archive,
	Bot,
	ListChecks,
	type LucideIcon,
	MessageSquareQuote,
	Pencil,
	Plus,
	RotateCcw,
	Trash2,
	Undo2,
	User,
	X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MemoryApiError, memoryApi } from "@/lib/memory-api";
import type {
	MemoryActor,
	MemoryEvent,
	MemoryEventKind,
} from "@/lib/memory-types";
import { TextDiff } from "./text-diff";

const PAGE = 60;

const KIND_ICON: Record<MemoryEventKind, LucideIcon> = {
	created: Plus,
	revised: Pencil,
	trashed: Trash2,
	restored: RotateCcw,
	purged: X,
};
const ACTOR_ICON: Record<MemoryActor, LucideIcon> = {
	user: User,
	agent: Bot,
	consolidation: ListChecks,
	import: Archive,
};

/** One mark on the spine: a single change, everything one conversation turn changed, or a run of
 * changes imported from before the log existed. */
type Entry =
	| { kind: "single"; key: string; at: string; event: MemoryEvent }
	| {
			kind: "turn";
			key: string;
			at: string;
			turn: number;
			evidence: string | null;
			events: MemoryEvent[];
	  }
	| {
			kind: "fold";
			key: string;
			at: string;
			of: "import" | "undo";
			events: MemoryEvent[];
	  };

/** Undos you make one after another (within this long) fold into one entry. */
const UNDO_RUN_MS = 2 * 60_000;

/** Every memory change on one spine, newest first, grouped by day and by the conversation turn
 * that caused it. Each change can be undone, which adds the opposite change; history never
 * shrinks. With `memoryId`, the history of one memory. */
export function Timeline({
	scope,
	memoryId,
	refreshKey,
	onChanged,
}: {
	scope?: string;
	memoryId?: string;
	refreshKey?: number;
	onChanged: () => void;
}) {
	const t = useTranslations("memory");
	const format = useFormatter();
	const [events, setEvents] = useState<MemoryEvent[] | null>(null);
	const [more, setMore] = useState(false);
	const [busy, setBusy] = useState<number | null>(null);
	const [error, setError] = useState("");

	const load = useCallback(async () => {
		const list = memoryId
			? await memoryApi.history(memoryId)
			: await memoryApi.events({ scope, limit: PAGE });
		setEvents(list);
		setMore(!memoryId && list.length === PAGE);
	}, [memoryId, scope]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a trigger
	useEffect(() => {
		load().catch(() => setEvents([]));
	}, [load, refreshKey]);

	const loadMore = async () => {
		const last = events?.[events.length - 1];
		if (!last) return;
		const page = await memoryApi.events({ scope, before: last.id, limit: PAGE });
		setEvents((e) => [...(e ?? []), ...page]);
		setMore(page.length === PAGE);
	};

	const undo = async (e: MemoryEvent) => {
		setBusy(e.id);
		setError("");
		try {
			await memoryApi.revert(e.id);
			await load();
			onChanged();
		} catch (err) {
			setError(
				t("undoFailed", {
					message: err instanceof MemoryApiError ? err.message : "",
				}),
			);
		} finally {
			setBusy(null);
		}
	};

	const days = useMemo(() => byDay(group(events ?? [])), [events]);
	const byId = useMemo(
		() => new Map((events ?? []).map((e) => [e.id, e])),
		[events],
	);
	const undoneAt = useMemo(() => {
		const at = new Map<number, string>();
		for (const e of events ?? [])
			if (e.reverts) at.set(e.reverts, e.created_at);
		return at;
	}, [events]);

	if (events === null)
		return <div className="tl tl-loading" aria-busy="true" />;
	if (events.length === 0)
		return (
			<div className="tl tl-empty">
				<span className="tl-node" aria-hidden="true">
					<ListChecks />
				</span>
				<p>{t("noEvents")}</p>
				<p className="tl-hint">{t("emptyHint")}</p>
			</div>
		);

	const time = (iso: string) =>
		format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" });
	const dayLabel = (iso: string) => {
		const d = new Date(iso);
		const today = new Date();
		const ago = Math.round(
			(startOfDay(today).getTime() - startOfDay(d).getTime()) / 86_400_000,
		);
		if (ago === 0) return t("today");
		if (ago === 1) return t("yesterday");
		return format.dateTime(d, {
			month: "long",
			day: "numeric",
			weekday: "short",
			...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
		});
	};

	const change = (e: MemoryEvent, nested: boolean) => {
		const undone = undoneAt.get(e.id);
		return (
			<Change
				key={e.id}
				event={e}
				nested={nested}
				showTitle={!memoryId}
				undoneAt={undone ? time(undone) : null}
				undid={e.reverts ? byId.get(e.reverts) : undefined}
				busy={busy}
				onUndo={undo}
			/>
		);
	};

	let n = 0; // stagger position across the whole list
	return (
		<div className={`tl${memoryId ? " tl-compact" : ""}`}>
			{error && (
				<p role="alert" className="tl-error">
					{error}
				</p>
			)}
			{days.map(([day, entries]) => (
				<section key={day} className="tl-day">
					<h3 className="tl-day-label">{dayLabel(entries[0].at)}</h3>
					<ol className="tl-list">
						{entries.map((entry) => {
							const style = { "--i": Math.min(n++, 12) } as React.CSSProperties;
							const when = (
								<time className="tl-time" dateTime={entry.at}>
									{time(entry.at)}
								</time>
							);
							if (entry.kind === "single")
								return (
									<li key={entry.key} className="tl-entry" style={style}>
										{when}
										{change(entry.event, false)}
									</li>
								);
							if (entry.kind === "turn")
								return (
									<li
										key={entry.key}
										className="tl-entry tl-turn"
										style={style}
									>
										{when}
										<div className="tl-group">
											<span className="tl-node tl-node-turn" aria-hidden="true">
												<MessageSquareQuote />
											</span>
											<div className="tl-main">
												<p className="tl-said">
													<span className="tl-said-label">
														{t("inChat", { turn: entry.turn + 1 })}
													</span>
													{entry.evidence && <q>{entry.evidence}</q>}
												</p>
												<ol className="tl-changes">
													{entry.events.map((e) => change(e, true))}
												</ol>
											</div>
										</div>
									</li>
								);
							return (
								<li key={entry.key} className="tl-entry tl-fold" style={style}>
									{when}
									<div className="tl-group">
										<span className="tl-node tl-node-fold" aria-hidden="true">
											{entry.of === "import" ? <Archive /> : <Undo2 />}
										</span>
										<details className="tl-main">
											<summary>
												{t(entry.of === "import" ? "imported" : "undidMany", {
													count: entry.events.length,
												})}
											</summary>
											<ol className="tl-changes">
												{entry.events.map((e) => change(e, true))}
											</ol>
										</details>
									</div>
								</li>
							);
						})}
					</ol>
				</section>
			))}
			{more && (
				<button
					type="button"
					className="tl-more"
					onClick={() => void loadMore()}
				>
					{t("loadMore")}
				</button>
			)}
		</div>
	);
}

function Change({
	event: e,
	nested,
	showTitle,
	undoneAt,
	undid,
	busy,
	onUndo,
}: {
	event: MemoryEvent;
	nested: boolean;
	showTitle: boolean;
	undoneAt: string | null;
	/** The change this one undid, when it is an undo and that change is loaded. */
	undid?: MemoryEvent;
	busy: number | null;
	onUndo: (e: MemoryEvent) => void;
}) {
	const t = useTranslations("memory");
	// An undo reads as what it undid ("Undid · Remembered …"), not as the opposite change it made.
	const Icon = e.reverts ? Undo2 : KIND_ICON[e.kind];
	const verbOf = (ev: MemoryEvent) => t(`verb.${ev.kind}`);
	const Actor = ACTOR_ICON[e.actor];
	const snap = e.after ?? e.before;
	const erased = snap !== null && snap.title === null;
	const revised =
		e.kind === "revised" &&
		e.before?.content != null &&
		e.after?.content != null;
	const canUndo = !e.reverted_by && e.kind !== "purged" && !erased;

	const Tag = nested ? "li" : "div";
	const className = [
		"tl-change",
		nested && "is-nested",
		e.reverted_by && "is-undone",
	]
		.filter(Boolean)
		.join(" ");
	return (
		<Tag className={className} data-kind={e.reverts ? "undo" : e.kind}>
			<span className="tl-node" aria-hidden="true">
				<Icon />
			</span>
			<div className="tl-main">
				<p className="tl-head">
					<span className="tl-verb">{e.reverts ? t("undid") : verbOf(e)}</span>
					{e.reverts && (
						<span className="tl-was">
							{undid ? verbOf(undid) : t("aChange")}
						</span>
					)}
					{showTitle && snap && (
						<span className={`tl-title${erased ? " is-erased" : ""}`}>
							{erased ? t("erased") : snap.title}
						</span>
					)}
					{revised && e.revision != null && (
						<span className="tl-rev">{t("revision", { n: e.revision })}</span>
					)}
					<span className="tl-actor">
						<Actor aria-hidden="true" />
						{t(`actor.${e.actor}`)}
					</span>
				</p>
				{revised ? (
					<TextDiff
						before={e.before?.content ?? ""}
						after={e.after?.content ?? ""}
					/>
				) : (
					e.kind === "created" &&
					e.after?.content && <p className="tl-content">{e.after.content}</p>
				)}
				{e.reason && !e.reverts && e.actor !== "import" && (
					<p className="tl-why">{t("why", { reason: e.reason })}</p>
				)}
				{!nested && e.evidence && (
					<p className="tl-said">
						<q>{e.evidence}</q>
					</p>
				)}
				{undoneAt && (
					<p className="tl-undone-note">{t("undoneAt", { time: undoneAt })}</p>
				)}
			</div>
			{canUndo && (
				<button
					type="button"
					className="tl-undo"
					disabled={busy !== null}
					onClick={() => onUndo(e)}
				>
					<RotateCcw aria-hidden="true" />
					{t("undo")}
				</button>
			)}
		</Tag>
	);
}

/** Consecutive changes from the same conversation turn become one entry; so do runs of imports,
 * and undos made one after another. */
function group(events: MemoryEvent[]): Entry[] {
	const entries: Entry[] = [];
	for (const e of events) {
		const last = entries[entries.length - 1];
		if (e.thread_id && e.turn != null) {
			const key = `turn:${e.thread_id}:${e.turn}`;
			if (last?.kind === "turn" && last.key === key) {
				last.events.push(e);
				last.evidence ??= e.evidence;
			} else {
				entries.push({
					kind: "turn",
					key,
					at: e.created_at,
					turn: e.turn,
					evidence: e.evidence,
					events: [e],
				});
			}
		} else if (e.actor === "import") {
			if (last?.kind === "fold" && last.of === "import") last.events.push(e);
			else
				entries.push({
					kind: "fold",
					of: "import",
					key: `import:${e.id}`,
					at: e.created_at,
					events: [e],
				});
		} else if (e.reverts && last && undoRun(last, e)) {
			if (last.kind === "fold") last.events.push(e);
			else
				entries[entries.length - 1] = {
					kind: "fold",
					of: "undo",
					key: `undo:${last.key}`,
					at: last.at,
					events: [(last as { event: MemoryEvent }).event, e],
				};
		} else {
			entries.push({
				kind: "single",
				key: `event:${e.id}`,
				at: e.created_at,
				event: e,
			});
		}
	}
	return entries;
}

function undoRun(last: Entry, e: MemoryEvent): boolean {
	const prev =
		last.kind === "single"
			? last.event
			: last.kind === "fold" && last.of === "undo"
				? last.events[last.events.length - 1]
				: null;
	return (
		prev !== null &&
		Boolean(prev.reverts) &&
		prev.actor === e.actor &&
		Math.abs(Date.parse(prev.created_at) - Date.parse(e.created_at)) <=
			UNDO_RUN_MS
	);
}

function byDay(entries: Entry[]): [string, Entry[]][] {
	const days = new Map<string, Entry[]>();
	for (const entry of entries) {
		const day = startOfDay(new Date(entry.at)).toISOString();
		days.set(day, [...(days.get(day) ?? []), entry]);
	}
	return [...days];
}

function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
