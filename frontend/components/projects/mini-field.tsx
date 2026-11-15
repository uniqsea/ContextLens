import { layerColor } from "@/lib/lens/types";
import type { Mix } from "@/lib/projects/types";

/* The memory field in miniature, for a card's cover: the last request as a spine, and what it
   carried as cards wired to their segments, each in its kind's outline. Drawn from the mix a
   conversation records with every answered turn, so it is that conversation's own picture. */
const ORDER = ["system", "memory", "retrieval", "short_term", "user"] as const;
const CARDS = ["memory", "retrieval", "short_term"] as const;
const W = 260;
const H = 110;
const TOP = 10;
const TALL = H - TOP * 2;
const SPINE_X = 26;
const SPINE_W = 8;
const CARD_X = 96;
const CARD_W = 104;
const CARD_H = 13;
const GAP = 5;
/** More than this many sources and the rest are a count. */
const SHOWN = 5;

function outline(kind: (typeof CARDS)[number], y: number) {
	const x = CARD_X;
	const r = 5;
	const right = x + CARD_W;
	const bottom = y + CARD_H;
	// A document: a sheet with its corner turned.
	if (kind === "retrieval")
		return `M${x + 2} ${y} H${right - 6} L${right} ${y + 6} V${bottom - 2} Q${right} ${bottom} ${right - 2} ${bottom} H${x + 2} Q${x} ${bottom} ${x} ${bottom - 2} V${y + 2} Q${x} ${y} ${x + 2} ${y} Z`;
	// A piece of conversation: a bubble, square where it is spoken from. A memory: a rounded card.
	const tail = kind === "short_term" ? 1 : r;
	return `M${x + r} ${y} H${right - r} Q${right} ${y} ${right} ${y + r} V${bottom - r} Q${right} ${bottom} ${right - r} ${bottom} H${x + tail} Q${x} ${bottom} ${x} ${bottom - tail} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

export function MiniField({ mix }: { mix: Mix }) {
	const parts = ORDER.map((layer) => ({
		layer,
		tokens: mix[layer]?.[0] ?? 0,
		count: mix[layer]?.[1] ?? 0,
	})).filter((p) => p.tokens > 0);
	const total = parts.reduce((sum, p) => sum + p.tokens, 0);
	const room = TALL - (parts.length - 1) * 2;
	let y = TOP;
	const segments = parts.map((p) => {
		const h = Math.max(3, (p.tokens / total) * room);
		const seg = { ...p, y, h };
		y += h + 2;
		return seg;
	});
	const sources = segments.flatMap((s) =>
		CARDS.includes(s.layer as (typeof CARDS)[number])
			? Array.from({ length: s.count }, () => s)
			: [],
	);
	const shown = sources.slice(0, SHOWN);
	const stack = shown.length * (CARD_H + GAP) - GAP;
	const first = (H - stack) / 2;
	return (
		<svg
			className="mini-field"
			viewBox={`0 0 ${W} ${H}`}
			aria-hidden="true"
			focusable="false"
		>
			{shown.map((s, i) => {
				const from = s.y + s.h / 2;
				const to = first + i * (CARD_H + GAP) + CARD_H / 2;
				const x1 = SPINE_X + SPINE_W;
				const x2 = CARD_X - 4;
				const mid = (x1 + x2) / 2;
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: the drawing is rebuilt whole from the mix
					<g key={i} style={{ color: layerColor(s.layer) }}>
						<path
							d={`M${x1} ${from} C${mid} ${from} ${mid} ${to} ${x2} ${to}`}
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							opacity="0.8"
						/>
						<circle cx={x2} cy={to} r="2.5" fill="currentColor" />
						<path
							className="mini-field-card"
							d={outline(s.layer as (typeof CARDS)[number], to - CARD_H / 2)}
						/>
					</g>
				);
			})}
			{segments.map((s) => (
				<rect
					key={s.layer}
					x={SPINE_X}
					y={s.y}
					width={SPINE_W}
					height={s.h}
					rx="1.5"
					fill={layerColor(s.layer)}
				/>
			))}
			{sources.length > shown.length && (
				<text
					className="mini-field-more"
					x={CARD_X + CARD_W + 10}
					y={first + stack - 2}
				>
					+{sources.length - shown.length}
				</text>
			)}
		</svg>
	);
}
