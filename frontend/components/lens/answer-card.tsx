"use client";

import { createPortal } from "react-dom";
import { useLocale } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { htmlLang } from "@/i18n/config";
import { useLensText } from "@/lib/lens/text";
import type { Candidate, Change, Segment, TurnRecord } from "@/lib/lens/types";
import { FIELD_LAYERS, layerColor } from "@/lib/lens/types";
import type { Concept, Scene } from "@/lib/memory-types";
import {
	ContextMeter,
	ContextStrip,
	type Peek,
	stripItems,
	stripTokens,
} from "./context-meter";
import { MemoryChanges } from "./memory-changes";
import { TurnReading } from "./turn-reading";
import { TurnSteps } from "./turn-steps";

export interface Rewrite {
	excluded: string[];
	pinned: string[];
	note: Change[];
	situation?: { doing: string; scenes: string[] };
	brighten?: string[];
	dim?: string[];
}

type Piece =
	| { kind: "keep" | "new"; seg: Segment }
	| { kind: "gone"; text: string };

/** Sentence-level diff so a rewrite only re-inks what actually changed. */
function diff(prev: Segment[], next: Segment[]): Piece[] {
	const n = prev.length;
	const m = next.length;
	const L = Array.from({ length: n + 1 }, () =>
		new Array<number>(m + 1).fill(0),
	);
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			L[i][j] =
				prev[i].text === next[j].text
					? L[i + 1][j + 1] + 1
					: Math.max(L[i + 1][j], L[i][j + 1]);
	const out: Piece[] = [];
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && prev[i].text === next[j].text) {
			out.push({ kind: "keep", seg: next[j] });
			i++;
			j++;
		} else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) {
			out.push({ kind: "new", seg: next[j] });
			j++;
		} else {
			out.push({ kind: "gone", text: prev[i].text });
			i++;
		}
	}
	return out;
}

/** Models write Markdown, and sentences stay separate spans for attribution, so each span renders
 * its own emphasis. A pair split across two sentences loses its markers rather than showing them. */
function InlineText({ text }: { text: string }) {
	const clean = text
		.replace(/^#{1,6}\s+(.+)$/gm, "**$1**")
		.replace(/^(\s*)[-*]\s+/gm, "$1• ")
		.replace(/^\s*-{3,}\s*$/gm, "");
	return clean.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/).map((part, i) => {
		// biome-ignore-start lint/suspicious/noArrayIndexKey: parts of one fixed string, in order
		if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
			return <strong key={i}>{part.slice(2, -2)}</strong>;
		if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
			return <code key={i}>{part.slice(1, -1)}</code>;
		return <span key={i}>{part.replace(/\*\*/g, "")}</span>;
		// biome-ignore-end lint/suspicious/noArrayIndexKey: parts of one fixed string, in order
	});
}

export function AnswerCard({
	sourceFocus,
	stepsHost,
	onShowSteps,
	index,
	record,
	streamingText,
	busy,
	usage,
	onRewrite,
	onUndo,
	onHover,
	onStale,
	threadId,
	onMemoryChanged,
	scenes,
	concepts,
}: {
	sourceFocus: string[] | null;
	stepsHost: HTMLElement | null;
	onShowSteps: () => void;
	index: number;
	record: TurnRecord | undefined;
	threadId: string | null;
	onMemoryChanged: () => void;
	scenes: Scene[];
	concepts: Concept[];
	streamingText: string | null;
	busy: boolean;
	usage: (id: string) => number;
	onRewrite: (turn: number, change: Rewrite) => void;
	onUndo: (turn: number) => void;
	onHover: (ids: string[] | null, turn: number) => void;
	onStale: (ids: string[], turn: number) => void;
}) {
	const text = useLensText();
	const { t } = text;
	const latest = record?.versions[record.versions.length - 1];
	const count = record?.versions.length ?? 0;
	const [peek, setPeek] = useState<Peek | null>(null);
	const [pieces, setPieces] = useState<Piece[] | null>(null);
	const prev = useRef<{ count: number; segments: Segment[] } | null>(null);

	// Re-ink only when the version changes after the first render.
	useEffect(() => {
		if (!latest) return;
		const before = prev.current;
		prev.current = { count, segments: latest.segments };
		if (!before || before.count === count) return;
		setPieces(diff(before.segments, latest.segments));
		const t = setTimeout(() => setPieces(null), 2600);
		return () => clearTimeout(t);
	}, [count, latest]);

	const segments: Piece[] =
		pieces ??
		(latest?.segments ?? []).map((seg) => ({ kind: "keep" as const, seg }));
	// Keys follow the text so unchanged sentences survive a rewrite; repeats get a count.
	const seen = new Map<string, number>();
	const keyOf = (text: string) => {
		const n = (seen.get(text) ?? 0) + 1;
		seen.set(text, n);
		return `${text}#${n}`;
	};
	const assembled = latest?.assembled_ids ?? latest?.selected_ids ?? [];
	const stale = latest
		? latest.candidates
				.filter((c) => c.stale && assembled.includes(c.id))
				.map((c) => c.id)
		: [];
	const strip = latest
		? stripItems(latest.candidates, assembled, record?.query ?? "", text)
		: [];

	return (
		<div className="lens-a turn-answer" data-turn={index}>
			{(count > 1 || busy) && (
				<div className="bar">
					{count > 1 && (
						<>
							<span className="v">{t("answer.version", { n: count })}</span>
							<span>{latest && text.note(latest.note, latest.candidates)}</span>
							<button
								type="button"
								onClick={() => onUndo(index)}
								disabled={busy}
							>
								{t("answer.undo")}
							</button>
						</>
					)}
					{busy && <span className="busy">{t("answer.rewriting")}</span>}
				</div>
			)}
			{streamingText !== null ? (
				<p className="lens-answer streaming">
					<InlineText text={streamingText} />
				</p>
			) : (
				<p className="lens-answer">
					{segments.map((p, k) =>
						p.kind === "gone" ? (
							<del key={keyOf(`gone:${p.text}`)} className="gone">
								<InlineText text={p.text} />
							</del>
						) : (
							<span
								key={keyOf(`seg:${p.seg.text}`)}
								className={
									"seg" +
									(p.seg.src.length ? "" : " nosrc") +
									(p.kind === "new" ? " ink" : "")
								}
								style={
									p.kind === "new"
										? { animationDelay: `${k * 90}ms` }
										: undefined
								}
								data-src={p.seg.src.join(" ")}
								title={
									p.seg.src.length
										? t("answer.basis", {
												titles: p.seg.src
													.map((id) => {
														const c = latest?.candidates.find(
															(x) => x.id === id,
														);
														return c ? text.title(c) : id;
													})
													.join(" · "),
											})
										: t("answer.noBasis")
								}
							>
								<InlineText text={p.seg.text} />
							</span>
						),
					)}
				</p>
			)}
			{latest && (
				<>
					<div className="lens-rcpt">
						<ContextStrip
							items={strip}
							mini
							onHover={(ids) => onHover(ids, index)}
							onPeek={setPeek}
						/>
						<span>
							{peek
								? t("lens.stripSegment", {
										label: peek.label,
										tokens: peek.tokens,
									})
								: t("answer.receipt", {
										count: assembled.filter((id) =>
											FIELD_LAYERS.includes(
												latest.candidates.find((c) => c.id === id)?.layer ??
													"system",
											),
										).length,
										tokens: stripTokens(strip),
									})}
						</span>
						{stale.length > 0 && (
							<button
								type="button"
								className="warn"
								onClick={(e) => {
									e.stopPropagation();
									onStale(stale, index);
								}}
							>
								{t("answer.stale", { count: stale.length })}
							</button>
						)}
					</div>
					<button
						type="button"
						className="lens-text-btn step-link"
						aria-controls="turn-steps-canvas"
						onClick={onShowSteps}
					>
						{t("turnSteps.showCanvas")} ↗
					</button>
					{stepsHost &&
						createPortal(
							<TurnSteps
								sourceFocus={sourceFocus}
								key={latest.created_at}
								version={latest}
								query={record?.query ?? ""}
								rewrite={count > 1}
								readingControls={
									latest.situation && (
										<TurnReading
											version={latest}
											scenes={scenes}
											concepts={concepts}
											busy={busy}
											onRewrite={(change) => onRewrite(index, change)}
										/>
									)
								}
								contextControls={
									<ContextEditor
										index={index}
										query={record?.query ?? ""}
										version={latest}
										usage={usage}
										onHover={onHover}
										busy={busy}
										onRewrite={(change) => onRewrite(index, change)}
									/>
								}
							/>,
							stepsHost,
						)}
					<MemoryChanges
						changes={record?.memory_changes ?? []}
						threadId={threadId}
						onChanged={onMemoryChanged}
					/>
				</>
			)}
		</div>
	);
}

function ContextEditor({
	index,
	query,
	version,
	usage,
	onHover,
	busy,
	onRewrite,
}: {
	index: number;
	query: string;
	version: NonNullable<TurnRecord["versions"][number]>;
	usage: (id: string) => number;
	onHover: (ids: string[] | null, turn: number) => void;
	busy: boolean;
	onRewrite: (change: Rewrite) => void;
}) {
	const text = useLensText();
	const { t } = text;
	const locale = useLocale();
	const [excluded, setExcluded] = useState<Set<string>>(
		() => new Set(version.excluded),
	);
	const [pinned, setPinned] = useState<Set<string>>(
		() => new Set(version.pinned),
	);
	const [notes, setNotes] = useState<Change[]>([]);
	const items = useMemo(
		() =>
			version.candidates.filter(
				(c) => FIELD_LAYERS.includes(c.layer) && c.status !== "trashed",
			),
		[version],
	);
	const selected = version.assembled_ids ?? version.selected_ids;
	const included = [...new Set([...selected, ...pinned])].filter(
		(id) => !excluded.has(id),
	);
	const using = (c: Candidate) => included.includes(c.id);
	const used = included
		.map((id) => items.find((c) => c.id === id))
		.filter((c) => c !== undefined);
	const unused = items.filter((c) => !using(c));
	const change = (note: Change, fn: () => void) => {
		fn();
		setNotes((n) => [...n, note]);
	};

	const exclude = (id: string) =>
		change({ op: "exclude", id }, () => {
			setExcluded((s) => new Set(s).add(id));
			setPinned((s) => {
				const t = new Set(s);
				t.delete(id);
				return t;
			});
		});

	const row = (c: Candidate) => {
		const isIn = using(c);
		const n = usage(c.id);
		const reason = excluded.has(c.id)
			? t("reasons.excludedHere")
			: pinned.has(c.id) && !selected.includes(c.id)
				? t("reasons.manual")
				: text.reason(c);
		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: hover only previews focus; the buttons carry the actions
			<div
				key={c.id}
				className={`item${isIn ? "" : " off"}`}
				style={{ "--c": layerColor(c.layer) } as React.CSSProperties}
				data-iid={c.id}
				onMouseEnter={() => onHover([c.id], index)}
				onMouseLeave={() => onHover(null, index)}
			>
				<i />
				<div className="tx">
					<b>
						{t("items.titleContent", {
							title: text.title(c),
							content: c.content,
						})}
					</b>
					<small className={c.stale ? "stale" : ""}>
						{text.layer(c.layer)}
						{c.source_label && c.layer !== "short_term"
							? ` · ${c.source_label}`
							: ""}
						{c.stale ? ` · ${t("items.maybeStale")}` : ""}
					</small>
					<small>
						{reason}
						{n ? t("back.usedBy", { count: n }) : ""}
					</small>
				</div>
				<div className="acts">
					{isIn && (
						<button type="button" onClick={() => exclude(c.id)}>
							{t("back.exclude")}
						</button>
					)}
					{!isIn && excluded.has(c.id) && (
						<button
							type="button"
							onClick={() =>
								change({ op: "restore", id: c.id }, () => {
									if (!selected.includes(c.id))
										setPinned((s) => new Set(s).add(c.id));
									setExcluded((s) => {
										const t = new Set(s);
										t.delete(c.id);
										return t;
									});
								})
							}
						>
							{t("back.restore")}
						</button>
					)}
					{!isIn && !excluded.has(c.id) && (
						<button
							type="button"
							onClick={() =>
								change({ op: "pin", id: c.id }, () =>
									setPinned((s) => new Set(s).add(c.id)),
								)
							}
						>
							{t("back.add")}
						</button>
					)}
				</div>
			</div>
		);
	};

	const dirty = notes.length > 0;
	return (
		<>
			{/* Leaving something out here folds the bar and rolls the figure down, before any rewrite. */}
			<ContextMeter
				card
				items={stripItems(
					version.candidates,
					used.map((c) => c.id),
					query,
					text,
				)}
				pressed={notes.length}
				onRemove={(id) => exclude(id)}
				onHover={(ids) => onHover(ids, index)}
			/>
			<h4>
				<span>{t("turnSteps.included")}</span>
				<span>
					{t("back.seenMeta", {
						count: used.length,
						time: new Intl.DateTimeFormat(htmlLang(locale), {
							dateStyle: "short",
							timeStyle: "short",
						}).format(new Date(version.created_at)),
					})}
				</span>
			</h4>
			<div className="items">
				<div
					className="item"
					style={{ "--c": "var(--l-kind-sys)" } as React.CSSProperties}
				>
					<i />
					<div className="tx">
						<b>{t("items.system")}</b>
						<small>{t("items.systemDesc")}</small>
					</div>
					<div className="acts" />
				</div>
				{used.map(row)}
				<div
					className="item"
					style={{ "--c": "var(--l-kind-user)" } as React.CSSProperties}
				>
					<i />
					<div className="tx">
						<b>{query}</b>
						<small>{t("items.question")}</small>
					</div>
					<div className="acts" />
				</div>
			</div>
			{unused.length > 0 && (
				<>
					<h4>
						<span>{t("back.unused")}</span>
						<span />
					</h4>
					<div className="items">{unused.map(row)}</div>
				</>
			)}
			<div className="step-editor-actions">
				{dirty && (
					<span className="dirty">
						{t("back.dirty", { count: notes.length })}
					</span>
				)}
				<button
					type="button"
					className="primary"
					disabled={busy || !dirty}
					onClick={() =>
						onRewrite({
							excluded: [...excluded],
							pinned: [...pinned],
							note: notes,
						})
					}
				>
					{t("lens.rewrite")}
				</button>
			</div>
		</>
	);
}
