"use client";

import { Maximize, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/tooltip";
import { layerColor, type TurnRecord } from "@/lib/lens/types";
import { bindCanvasNavigation } from "./canvas-navigation";
import styles from "./conversation-map.module.css";
import {
	type CrossLink,
	crossLinks,
	type LinkKind,
	type MapEnd,
} from "./conversation-map-model";
import { TurnSteps } from "./turn-steps";

const KINDS: LinkKind[] = ["history", "written", "again"];
/** Where a step's title line sits, as its own flow's wires use it. */
const PORT_Y = 20;
/** The room between turns, which the wires from one to the next cross; matches the stylesheet. */
const GAP = 112;
const endKey = (end: MapEnd) => `${end.turn}:${end.node}`;

/**
 * The whole conversation on one canvas: every answered turn with all of its steps, one under the
 * other, and wires between the turns for what one handed to a later one.
 */
export function ConversationMap({
	open,
	onOpenChange,
	records,
	onOpenTurn,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	records: Record<string, TurnRecord>;
	onOpenTurn: (turn: number) => void;
}) {
	const t = useTranslations("conversationMap");
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="top-0 left-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none bg-stage p-0 sm:max-w-none">
				<DialogTitle className="sr-only">{t("title")}</DialogTitle>
				<DialogDescription className="sr-only">
					{t("description")}
				</DialogDescription>
				{open && <MapCanvas records={records} onOpenTurn={onOpenTurn} />}
			</DialogContent>
		</Dialog>
	);
}

interface Drawn {
	link: CrossLink;
	d: string;
}

function MapCanvas({
	records,
	onOpenTurn,
}: {
	records: Record<string, TurnRecord>;
	onOpenTurn: (turn: number) => void;
}) {
	const t = useTranslations("conversationMap");
	const ordered = useMemo(
		() =>
			Object.values(records)
				.filter((r) => r.versions.length > 0)
				.sort((a, b) => a.index - b.index),
		[records],
	);
	const links = useMemo(() => crossLinks(ordered), [ordered]);
	const kinds = KINDS.filter((kind) => links.some((l) => l.kind === kind));

	const viewport = useRef<HTMLDivElement>(null);
	const world = useRef<HTMLDivElement>(null);
	const nav = useRef<ReturnType<typeof bindCanvasNavigation> | null>(null);
	const [scale, setScale] = useState(1);
	const [drawn, setDrawn] = useState<Drawn[]>([]);
	/** The step under the pointer: its wires stand out and the rest step back. */
	const [hot, setHot] = useState<string | null>(null);
	/** Turns run left to right and wrap, in as many columns as show the most at once. */
	const [columns, setColumns] = useState(1);

	const fit = useCallback(() => {
		const box = viewport.current;
		const content = world.current;
		if (!box || !content || !nav.current) return;
		const margin = 48;
		const next = Math.min(
			1,
			(box.clientWidth - margin * 2) / content.offsetWidth,
			(box.clientHeight - margin * 2) / content.offsetHeight,
		);
		const s = Math.max(0.08, next);
		nav.current.move(
			Math.max(margin, (box.clientWidth - content.offsetWidth * s) / 2),
			Math.max(margin, (box.clientHeight - content.offsetHeight * s) / 2),
			s,
		);
	}, []);

	// Laid out once, from the turns' own sizes: the column count whose shape fits the window best.
	useLayoutEffect(() => {
		const box = viewport.current;
		const sections =
			world.current?.querySelectorAll<HTMLElement>("[data-map-turn]");
		if (!box || !sections?.length) return;
		const sizes = [...sections].map((el) => [el.offsetWidth, el.offsetHeight]);
		const wide = Math.max(...sizes.map(([w]) => w)) + GAP;
		const tall = Math.max(...sizes.map(([, h]) => h)) + GAP;
		let best = 1;
		let most = 0;
		for (let n = 1; n <= sizes.length; n++) {
			const fits = Math.min(
				box.clientWidth / (n * wide),
				box.clientHeight / (Math.ceil(sizes.length / n) * tall),
			);
			if (fits > most) {
				most = fits;
				best = n;
			}
		}
		setColumns(best);
	}, []);

	useLayoutEffect(() => {
		const box = viewport.current;
		const content = world.current;
		if (!box || !content) return;
		nav.current = bindCanvasNavigation(
			box,
			// The wheel zooms anywhere; a drag pans unless it starts on something to press.
			(target, pan) =>
				!pan ||
				!(target instanceof Element) ||
				!target.closest("button, a, summary, input, textarea"),
			(view) => {
				content.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
				setScale(view.scale);
			},
		);
		fit();
		box.focus({ preventScroll: true });
		return () => nav.current?.destroy();
	}, [fit]);

	// The wires between turns run from under the step that produced something to the side of the
	// step that took it in, measured from where the turns' own flows put those steps.
	useLayoutEffect(() => {
		const content = world.current;
		if (!content) return;
		const measure = () => {
			const origin = content.getBoundingClientRect();
			const s = origin.width / content.offsetWidth || 1;
			const find = (end: MapEnd) =>
				content
					.querySelector(`[data-map-turn="${end.turn}"]`)
					?.querySelector(`[data-flow-id="${CSS.escape(end.node)}"]`)
					?.getBoundingClientRect();
			setDrawn(
				links.flatMap((link) => {
					const from = find(link.from);
					const to = find(link.to);
					if (!from || !to) return [];
					// Sources stack in a column, so a wire comes in from the side, at the title line.
					const x2 = (to.left - origin.left) / s - 3;
					const y2 = (to.top - origin.top) / s + PORT_Y;
					const right = (from.right - origin.left) / s;
					// To a turn further along the row the wire carries on from the step's side, as the
					// wires inside a turn do; to one on a later row it drops out from under the step.
					if (x2 > right + 24) {
						const y1 = (from.top - origin.top) / s + PORT_Y;
						const run = Math.max(48, (x2 - right) * 0.5);
						return [
							{
								link,
								d: `M${right} ${y1} C${right + run} ${y1} ${x2 - run} ${y2} ${x2} ${y2}`,
							},
						];
					}
					const x1 = (from.left + from.width / 2 - origin.left) / s;
					const y1 = (from.bottom - origin.top) / s;
					const drop = Math.max(48, Math.abs(y2 - y1) * 0.5);
					const run = Math.max(48, Math.abs(x2 - x1) * 0.35);
					return [
						{
							link,
							d: `M${x1} ${y1} C${x1} ${y1 + drop} ${x2 - run} ${y2} ${x2} ${y2}`,
						},
					];
				}),
			);
		};
		// A card opening anywhere moves the steps after and under it.
		const observer = new ResizeObserver(measure);
		for (const el of content.querySelectorAll("[data-flow-id]"))
			observer.observe(el);
		observer.observe(content);
		measure();
		return () => observer.disconnect();
	}, [links]);

	// The flows settle their widths after the first paint; fit once more when they have.
	useEffect(() => {
		const frame = requestAnimationFrame(fit);
		return () => cancelAnimationFrame(frame);
	}, [fit]);

	const goTo = (turn: number) => {
		const box = viewport.current;
		const section = world.current?.querySelector<HTMLElement>(
			`[data-map-turn="${turn}"]`,
		);
		if (!box || !section) return;
		// Close enough to read, without zooming out of a closer look.
		const s = Math.min(1, Math.max(scale, 0.7));
		nav.current?.move(
			48 - section.offsetLeft * s,
			box.clientHeight * 0.18 - section.offsetTop * s,
			s,
		);
	};
	const touching = (d: Drawn) =>
		hot !== null && (endKey(d.link.from) === hot || endKey(d.link.to) === hot);
	const anyHot = drawn.some(touching);

	return (
		<div className={styles.map}>
			<div
				className={styles.viewport}
				ref={viewport}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas takes the arrow and zoom keys
				tabIndex={0}
				role="application"
				aria-label={t("title")}
				onPointerOver={(e) => {
					const node = (e.target as Element).closest?.("[data-flow-id]");
					const turn = node?.closest<HTMLElement>("[data-map-turn]");
					setHot(
						node && turn
							? `${turn.dataset.mapTurn}:${(node as HTMLElement).dataset.flowId}`
							: null,
					);
				}}
				onPointerLeave={() => setHot(null)}
			>
				<div
					className={styles.world}
					ref={world}
					style={{ gridTemplateColumns: `repeat(${columns}, max-content)` }}
				>
					{ordered.map((record) => {
						const version = record.versions[record.versions.length - 1];
						return (
							<section
								key={record.index}
								className={styles.turn}
								data-map-turn={record.index}
							>
								<Hint label={t("locate")} side="right">
									<button
										type="button"
										className={styles.heading}
										onClick={() => onOpenTurn(record.index)}
									>
										{t("turn", { n: record.index + 1 })}
									</button>
								</Hint>
								<TurnSteps
									key={version.created_at}
									sourceFocus={null}
									version={version}
									query={record.query}
									rewrite={record.versions.length > 1}
									readingControls={null}
									contextControls={null}
									unfolded
									changes={
										record.memory_changes ?? version.written_changes ?? []
									}
								/>
							</section>
						);
					})}
					<svg
						className={styles.links}
						data-hot={anyHot || undefined}
						aria-hidden="true"
					>
						<defs>
							{KINDS.map((kind) => (
								<marker
									key={kind}
									id={`map-arrow-${kind}`}
									viewBox="0 0 8 8"
									refX="7"
									refY="4"
									markerWidth="5"
									markerHeight="5"
									orient="auto"
								>
									<path d="M0 0 L8 4 L0 8 z" fill="context-stroke" />
								</marker>
							))}
						</defs>
						{drawn.map(({ link, d }) => (
							<path
								key={link.key}
								d={d}
								data-kind={link.kind}
								data-on={touching({ link, d }) || undefined}
								stroke={layerColor(link.layer)}
								markerEnd={`url(#map-arrow-${link.kind})`}
							/>
						))}
					</svg>
				</div>
			</div>

			<header className={styles.bar}>
				<h2>{t("title")}</h2>
				{ordered.length > 1 && (
					<nav aria-label={t("turns")}>
						{ordered.map((record) => (
							<button
								key={record.index}
								type="button"
								aria-label={t("turn", { n: record.index + 1 })}
								onClick={() => goTo(record.index)}
							>
								{record.index + 1}
							</button>
						))}
					</nav>
				)}
				{ordered.length === 0 ? (
					<p>{t("empty")}</p>
				) : (
					<ul>
						{kinds.map((kind) => (
							<li key={kind}>
								<svg viewBox="0 0 26 8" aria-hidden="true">
									<path
										d="M1 4 H25"
										data-kind={kind}
										stroke={layerColor(
											kind === "history" ? "short_term" : "memory",
										)}
									/>
								</svg>
								{t(`links.${kind}`)}
							</li>
						))}
					</ul>
				)}
			</header>

			<div className={`canvas-zoom-controls ${styles.zoom}`}>
				<Hint label={t("zoomOut")}>
					<button
						type="button"
						aria-label={t("zoomOut")}
						onClick={() => {
							const box = viewport.current;
							if (box)
								nav.current?.zoom(
									box.clientWidth / 2,
									box.clientHeight / 2,
									0.8,
								);
						}}
					>
						<Minus aria-hidden="true" />
					</button>
				</Hint>
				<span>{Math.max(1, Math.round(scale * 100))}%</span>
				<Hint label={t("zoomIn")}>
					<button
						type="button"
						aria-label={t("zoomIn")}
						disabled={scale >= 4}
						onClick={() => {
							const box = viewport.current;
							if (box)
								nav.current?.zoom(
									box.clientWidth / 2,
									box.clientHeight / 2,
									1.25,
								);
						}}
					>
						<Plus aria-hidden="true" />
					</button>
				</Hint>
				<Hint label={t("fit")}>
					<button
						type="button"
						className="canvas-fit"
						aria-label={t("fit")}
						onClick={fit}
					>
						<Maximize aria-hidden="true" />
					</button>
				</Hint>
			</div>
		</div>
	);
}
