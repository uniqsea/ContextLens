"use client";

/* The rolling figure (Roll) comes from the Context meter block by Bencho, MIT licensed:
   https://bencho.dev/licence
   Copyright (c) 2026 Lorenzo Cabra */

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { useLensText } from "@/lib/lens/text";
import type { Candidate, Layer } from "@/lib/lens/types";
import { layerColor } from "@/lib/lens/types";

export interface StripItem {
	id: string;
	label: string;
	tokens: number;
	layer: Layer;
	warn?: boolean;
	/** The question slot before anything is typed. */
	empty?: boolean;
}

/** Same kinds sit together, so the bar reads as a few colours rather than confetti. */
const PICKED: Layer[] = ["memory", "retrieval", "short_term"];

/** System prompt, the selected items and the question, sized by their token share. */
export function stripItems(
	candidates: Candidate[],
	selected: string[],
	query: string,
	text: ReturnType<typeof useLensText>,
): StripItem[] {
	const sys = candidates.find((c) => c.layer === "system");
	const byId = new Map(candidates.map((c) => [c.id, c]));
	const picked = selected
		.map((id) => byId.get(id))
		.filter((c): c is Candidate => !!c && PICKED.includes(c.layer));
	return [
		{
			id: sys?.id ?? "sys-001",
			label: text.layer("system"),
			tokens: sys?.tokens ?? 100,
			layer: "system",
		},
		...candidates
			.filter((c) => c.id === "sys-project" && selected.includes(c.id))
			.map((c) => ({
				id: c.id,
				label: text.title(c),
				tokens: c.tokens,
				layer: c.layer,
			})),
		...picked.map((c) => ({
			id: c.id,
			label: text.title(c),
			tokens: c.tokens,
			layer: c.layer,
			warn: !!c.stale,
		})),
		{
			id: "usr-001",
			label: query ? text.t("items.question") : text.t("items.waiting"),
			tokens: Math.max(12, Math.round(query.length * 1.3)),
			layer: "user",
			empty: !query,
		},
	];
}

export const stripTokens = (items: StripItem[]) =>
	items.reduce((a, i) => a + i.tokens, 0);

/** What the pointer is on: its name and its share, shown in place of the total. */
export interface Peek {
	label: string;
	tokens: number;
	layer: Layer;
}

/**
 * What the next request carries, as one bar: a segment per item, as wide as its share, each wired to
 * its card. Read-only under an answer (mini). Elsewhere a segment dragged up or down, or Delete on
 * it, leaves the item out. `pressed` counts those removals, and each one replays the bar's reaction.
 */
export function ContextStrip({
	items,
	mini = false,
	pressed = 0,
	onRemove,
	onHover,
	onPeek,
}: {
	items: StripItem[];
	mini?: boolean;
	pressed?: number;
	onRemove?: (id: string) => void;
	onHover?: (ids: string[] | null) => void;
	onPeek?: (peek: Peek | null) => void;
}) {
	const t = useTranslations("lens");
	const seen = useRef<Set<string>>(new Set(items.map((i) => i.id)));
	const drag = useRef<{ id: string; y: number; el: HTMLElement } | null>(null);
	const fresh = new Set(
		items.filter((i) => !seen.current.has(i.id)).map((i) => i.id),
	);
	seen.current = new Set(items.map((i) => i.id));
	const removable = (it: StripItem) =>
		!mini && !!onRemove && it.layer !== "system" && it.layer !== "user";

	return (
		<div
			className={`lens-strip${mini ? " mini" : ""}`}
			data-wave={pressed ? (pressed % 2 ? "a" : "b") : undefined}
		>
			{items.map((it, n) => {
				const show = () => {
					onHover?.(PICKED.includes(it.layer) ? [it.id] : null);
					onPeek?.({ label: it.label, tokens: it.tokens, layer: it.layer });
				};
				const hide = () => {
					onHover?.(null);
					onPeek?.(null);
				};
				const name =
					t("stripSegment", { label: it.label, tokens: it.tokens }) +
					(removable(it) ? t("stripRemovable") : "");
				const common = {
					className: [
						"sg",
						it.warn && "warn",
						it.empty && "empty",
						fresh.has(it.id) && "enter",
					]
						.filter(Boolean)
						.join(" "),
					style: {
						"--c": layerColor(it.layer),
						"--grow": it.tokens,
						// The reaction to a removal travels along the bar.
						"--wave": `${n * 55}ms`,
					} as React.CSSProperties,
					title: name,
					"data-sid": it.id,
					"data-layer": it.layer,
					onMouseEnter: show,
					onMouseLeave: hide,
				};
				if (mini) return <span key={it.id} {...common} />;
				return (
					<button
						key={it.id}
						type="button"
						{...common}
						aria-label={name}
						onFocus={show}
						onBlur={hide}
						onPointerDown={(e) => {
							if (!removable(it)) return;
							drag.current = { id: it.id, y: e.clientY, el: e.currentTarget };
							e.currentTarget.setPointerCapture(e.pointerId);
						}}
						onPointerMove={(e) => {
							const d = drag.current;
							if (d)
								d.el.classList.toggle("lift", Math.abs(e.clientY - d.y) > 18);
						}}
						onPointerUp={(e) => {
							const d = drag.current;
							drag.current = null;
							if (!d) return;
							d.el.classList.remove("lift");
							if (Math.abs(e.clientY - d.y) > 18) onRemove?.(d.id);
						}}
						onKeyDown={(e) => {
							if (
								(e.key === "Delete" || e.key === "Backspace") &&
								removable(it)
							)
								onRemove?.(it.id);
						}}
					/>
				);
			})}
		</div>
	);
}

/**
 * The odometer: each digit a one-line window. A digit that changes rises a hair out of a 2px blur
 * and lands a touch past its mark, left to right 70ms apart: from below when the figure grows, from
 * above when it shrinks. Digits are keyed by place and value, so one that did not change never moves.
 */
function Roll({ value }: { value: number }) {
	const format = useFormatter();
	const text = format.number(value);
	const last = useRef(value);
	const up = useRef(true);
	if (value !== last.current) {
		up.current = value > last.current;
		last.current = value;
	}
	const chars = [...text];
	return (
		<MotionConfig reducedMotion="user">
			<span className="lens-roll">
				<span className="sr-only">{text}</span>
				<span aria-hidden="true">
					{chars.map((c, i) => {
						// Places count from the right, so a new leading digit does not shift the rest.
						const place = chars.length - 1 - i;
						if (!/[0-9]/.test(c)) return <span key={`s${place}`}>{c}</span>;
						return (
							<span key={`p${place}`} className="lens-wheel">
								<AnimatePresence initial={false} mode="popLayout">
									<motion.span
										key={c}
										initial={{
											y: up.current ? "0.18em" : "-0.18em",
											opacity: 0,
											filter: "blur(2px)",
										}}
										animate={{ y: "0em", opacity: 1, filter: "blur(0px)" }}
										exit={{
											opacity: 0,
											filter: "blur(2px)",
											transition: { duration: 0.16 },
										}}
										transition={{
											duration: 0.5,
											ease: [0.34, 1.45, 0.64, 1],
											delay: i * 0.07,
										}}
									>
										{c}
									</motion.span>
								</AnimatePresence>
							</span>
						);
					})}
				</span>
			</span>
		</MotionConfig>
	);
}

/**
 * The bar and what it is made of. Pointing at a segment or a kind shows its name and share here and
 * focuses its cards on the field. There is no "of N": the app has no window limit to measure
 * against, and the tokens are an estimate.
 *
 * Inline it sits above the input: the bar and, while there is something to say, one line. As a card,
 * on the back of an answer, there is room for the whole figure.
 */
export function ContextMeter({
	items,
	card = false,
	details = true,
	idleHint,
	pressed,
	onRemove,
	onHover,
}: {
	items: StripItem[];
	card?: boolean;
	/** Inline, the line under the bar speaks only while it has something to say. */
	details?: boolean;
	idleHint?: string;
	pressed?: number;
	onRemove: (id: string) => void;
	onHover: (ids: string[] | null) => void;
}) {
	const t = useTranslations("lens");
	const tl = useTranslations("layers");
	const [peek, setPeek] = useState<Peek | null>(null);
	const kinds = PICKED.map((layer) => ({
		layer,
		items: items.filter((i) => i.layer === layer),
	})).filter((k) => k.items.length > 0);
	const figure = peek?.tokens ?? stripTokens(items);

	const strip = (
		<ContextStrip
			items={items}
			pressed={pressed}
			onRemove={onRemove}
			onHover={onHover}
			onPeek={setPeek}
		/>
	);
	const chips = (
		<div className="lens-meter-kinds">
			{kinds.map((k) => {
				const show = () => {
					onHover(k.items.map((i) => i.id));
					setPeek({
						label: tl(k.layer),
						tokens: stripTokens(k.items),
						layer: k.layer,
					});
				};
				const hide = () => {
					onHover(null);
					setPeek(null);
				};
				return (
					// Follows the kind in focus, not :hover: pointing at a segment presses its chip too.
					<button
						key={k.layer}
						type="button"
						data-on={peek?.layer === k.layer || undefined}
						style={{ "--c": layerColor(k.layer) } as React.CSSProperties}
						onMouseEnter={show}
						onMouseLeave={hide}
						onFocus={show}
						onBlur={hide}
					>
						{tl(k.layer)}
						<small>{k.items.length}</small>
					</button>
				);
			})}
			{kinds.length === 0 && idleHint && <span>{idleHint}</span>}
		</div>
	);

	if (card)
		return (
			<div className="lens-meter-card">
				<div className="lens-meter-figure">
					<span className="lens-meter-big">
						<Roll value={figure} />
					</span>
					<span className="lens-meter-of">
						{peek?.label ?? t("tokensEstimate")}
					</span>
				</div>
				{strip}
				{chips}
			</div>
		);

	return (
		<>
			{strip}
			{details && (
				<div className="lens-meter">
					{chips}
					<div className="lens-meter-total">
						{peek && <span className="lens-meter-name">{peek.label}</span>}
						<span>
							{t.rich("tokens", {
								n: () => <Roll value={figure} />,
							})}
						</span>
					</div>
				</div>
			)}
		</>
	);
}
