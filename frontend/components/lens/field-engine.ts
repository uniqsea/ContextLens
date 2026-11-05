/**
 * The memory field: cards drift on springs toward the place their state asks for,
 * and every card in use is wired to the sentence (or strip segment) that used it.
 * Framework-free on purpose: it runs every frame, so it writes the DOM directly.
 */
import type { CardState, Layer } from "@/lib/lens/types";
import { layerColor } from "@/lib/lens/types";
import { bindCanvasNavigation, type CanvasView } from "./canvas-navigation";
import { Wire } from "./wire";

export interface FieldCard {
	id: string;
	layer: Layer;
	title: string;
	content: string;
	meta: string;
	previewUrl?: string;
	previewLabel?: string;
	stale: boolean;
	scope: string;
	/** Worded by the caller: the layer's name and the unlink handle's label. */
	kind: string;
	unlink: string;
}

export interface Anchor {
	x: number;
	y: number;
	kind: "text" | "strip";
	fade?: boolean;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface FieldModel {
	fieldRight?: number;
	fieldBottom?: number;
	cards: FieldCard[];
	state: Record<string, CardState>;
	pinned: Set<string>;
	anchors: Record<string, Anchor>;
	sheet: Rect;
	form: Rect;
	answer: Rect | null;
	/** Phones: where the in-flow content ends and the field may start. */
	floor: number;
	/** Whether the shelf of unused cards is open. */
	shelf: boolean;
}

export type DropTarget = "tray" | "composer" | "none";

export interface FieldHandlers {
	model(): FieldModel;
	onDrop(id: string, target: DropTarget, state: CardState): void;
	onUnlink(id: string): void;
	onHover(id: string | null): void;
	onClick(id: string): void;
	/** How many cards you have placed by hand; zero once they are all tidied. */
	onPlaced(count: number): void;
	onScale(scale: number): void;
}

interface Live {
	card: FieldCard;
	el: HTMLButtonElement;
	wire: Wire;
	x: number;
	y: number;
	vx: number;
	vy: number;
	tx: number;
	ty: number;
	h: number;
	small: boolean;
	deck: boolean;
	shelved: boolean;
	/** In a sent column past the first: its wire has to cross nearer cards. */
	far: boolean;
	/** Folded to its title because the field cannot hold it whole; `h` stays its natural height. */
	tight: boolean;
	seed: number;
}

/** Column order for sent cards: what you own nearest, the transcript farthest. */
const CATEGORIES: Layer[] = ["memory", "retrieval", "short_term"];
const CARD_W = 212;
/** A card folded to its title, and the space between cards in a column. Keep TIGHT_H in step with `.lens-card.tight`. */
const TIGHT_H = 45;
const CARD_GAP = 10;
const cardH = (l: Live) => (l.tight ? TIGHT_H : l.h);
/** How far above the strip its wires run, inside the composer's top padding. */
const RAIL = 7;
const reduced = () =>
	typeof window !== "undefined" &&
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export class FieldEngine {
	private live = new Map<string, Live>();
	private raf = 0;
	private W = 0;
	private H = 0;
	private narrow = false;
	private CW = CARD_W;
	private tray: Rect = { x: 0, y: 0, w: 0, h: 0 };
	private shelf: Rect = { x: 0, y: 0, w: 0, h: 0 };
	private drag: {
		l: Live;
		ox: number;
		oy: number;
		sx: number;
		sy: number;
		moved: boolean;
	} | null = null;
	private handle: HTMLButtonElement;
	private heads = new Map<Layer, HTMLDivElement>();
	/** Cards dropped on open field stay put while their state stays the same. */
	private placed = new Map<
		string,
		{ x: number; y: number; state: CardState }
	>();
	private handleFor: Live | null = null;
	private hideT: ReturnType<typeof setTimeout> | undefined;
	private suppressClick = false;
	private counter = 0;
	private view: CanvasView = { x: 0, y: 0, scale: 1 };
	private navigation: ReturnType<typeof bindCanvasNavigation>;

	constructor(
		private stage: HTMLElement,
		private world: HTMLElement,
		private svg: SVGSVGElement,
		private zones: {
			tray: HTMLElement;
			shelf: HTMLElement;
		},
		private h: FieldHandlers,
	) {
		this.handle = document.createElement("button");
		this.handle.type = "button";
		this.handle.className = "lens-unlink";
		this.handle.hidden = true;
		this.handle.innerHTML =
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
		this.handle.addEventListener("mouseenter", () => clearTimeout(this.hideT));
		this.handle.addEventListener("mouseleave", () => this.hideHandle());
		this.handle.addEventListener("click", () => {
			const l = this.handleFor;
			if (!l) return;
			this.hideHandle(true);
			l.wire.snap();
			this.h.onUnlink(l.card.id);
		});
		world.appendChild(this.handle);
		this.navigation = bindCanvasNavigation(
			stage,
			(target, pan) => {
				if (this.drag || !(target instanceof Element)) return false;
				if (target === stage || target.classList.contains("canvas-backdrop"))
					return true;
				if (
					!world.contains(target) ||
					target.closest("textarea,input,select,[contenteditable=true]")
				)
					return false;
				return !pan || !target.closest("button,a,summary,.flow-node,.hit");
			},
			(view) => {
				if (view.scale !== this.view.scale) this.h.onScale(view.scale);
				this.view = view;
				// Layout zoom paints glyphs at the requested resolution. Pan in world units.
				world.style.setProperty("--canvas-scale", String(view.scale));
				world.style.transform = `translate(${view.x / view.scale}px, ${view.y / view.scale}px)`;
				stage.style.backgroundSize = `${22 * view.scale}px ${22 * view.scale}px`;
				stage.style.backgroundPosition = `${view.x + 11 * view.scale}px ${view.y + 11 * view.scale}px`;
			},
		);
	}

	private availableView() {
		const model = this.h.model();
		if (window.innerWidth <= 900) {
			const toolbar = this.stage.querySelector(".lens-fieldbar");
			const stageTop = this.stage.getBoundingClientRect().top;
			const top =
				(toolbar
					? toolbar.getBoundingClientRect().bottom - stageTop
					: model.floor) + 12;
			return {
				x: 12,
				y: top,
				w: this.stage.clientWidth - 24,
				h: Math.max(
					1,
					Math.min(
						window.innerHeight - 100,
						this.stage.clientHeight - top - 12,
					),
				),
			};
		}
		const left = model.sheet.x + model.sheet.w + 12;
		const right = (model.fieldRight ?? this.stage.clientWidth) - 12;
		const toolbar = this.stage.querySelector(".lens-fieldbar");
		const top = toolbar
			? toolbar.getBoundingClientRect().bottom -
				this.stage.getBoundingClientRect().top +
				12
			: 60;
		return {
			x: left,
			y: top,
			w: Math.max(1, right - left),
			h: Math.max(1, this.stage.clientHeight - top - 12),
		};
	}

	zoomBy(factor: number) {
		const area = this.availableView();
		this.navigation.zoom(area.x + area.w / 2, area.y + area.h / 2, factor);
	}

	fitAll() {
		const elements = this.world.querySelectorAll(
			".lens-card:not(.shelved), .lens-colhead:not([hidden]), .lens-shelf:not([hidden]), .steps-canvas header, .flow-node",
		);
		const area = this.availableView();
		const world = this.world.getBoundingClientRect();
		const { scale } = this.view;
		let left = Infinity,
			top = Infinity,
			right = -Infinity,
			bottom = -Infinity;
		for (const el of elements) {
			const box = el.getBoundingClientRect();
			if (!box.width || !box.height) continue;
			left = Math.min(left, (box.left - world.left) / scale);
			top = Math.min(top, (box.top - world.top) / scale);
			right = Math.max(right, (box.right - world.left) / scale);
			bottom = Math.max(bottom, (box.bottom - world.top) / scale);
		}
		if (!Number.isFinite(left)) {
			this.navigation.move(0, 0, 1);
			return;
		}
		const fit = Math.min(1, area.w / (right - left), area.h / (bottom - top));
		this.navigation.move(
			area.x + (area.w - (right + left) * fit) / 2,
			area.y + (area.h - (bottom + top) * fit) / 2,
			fit,
		);
		if (window.innerWidth <= 900) {
			window.scrollBy(0, this.stage.getBoundingClientRect().top + area.y - 16);
		}
	}

	locateSteps(panel: HTMLElement, tools: HTMLElement) {
		const model = this.h.model();
		if (window.innerWidth <= 900) {
			this.navigation.move(0, 0, 1);
			panel.querySelector("header")?.scrollIntoView({ block: "center" });
		} else {
			const left = model.sheet.x + model.sheet.w + 12;
			const right = (model.fieldRight ?? this.stage.clientWidth) - 12;
			const top =
				tools.getBoundingClientRect().bottom -
				this.stage.getBoundingClientRect().top +
				16;
			const scale = Math.min(
				1,
				Math.max(0.25, (right - left) / Math.max(1, panel.offsetWidth)),
			);
			const x = (left + right - panel.offsetWidth * scale) / 2;
			this.navigation.move(
				x - panel.offsetLeft * scale,
				top - panel.offsetTop * scale,
				scale,
			);
		}
		panel.focus({ preventScroll: true });
	}

	start() {
		const step = () => {
			// React detaches refs before effect cleanup runs; stop on that last frame.
			if (!this.stage.isConnected) return;
			this.frame();
			this.raf = requestAnimationFrame(step);
		};
		this.raf = requestAnimationFrame(step);
	}

	destroy() {
		this.navigation.destroy();
		this.world.style.transform = "";
		this.world.style.removeProperty("--canvas-scale");
		this.stage.style.backgroundSize = "";
		this.stage.style.backgroundPosition = "";
		cancelAnimationFrame(this.raf);
		this.stage.style.height = "";
		this.stage.classList.remove("dragging", "over-composer", "focusing");
		for (const l of [...this.live.values()]) this.removeLive(l);
		this.handle.remove();
		this.heads.forEach((h) => {
			h.remove();
		});
	}

	/** One label per category column; hidden when the column is empty. */
	private head(layer: Layer, text: string | null, x = 0, y = 0) {
		let h = this.heads.get(layer);
		if (!h) {
			h = document.createElement("div");
			h.className = "lens-colhead";
			h.style.setProperty("--c", layerColor(layer));
			this.world.appendChild(h);
			this.heads.set(layer, h);
		}
		h.hidden = text === null;
		if (text === null) return;
		if (h.textContent !== text) h.textContent = text;
		h.style.transform = `translate(${x}px, ${y}px)`;
	}

	/** Send every hand-placed card back to the automatic layout. */
	tidy() {
		this.placed.clear();
		this.h.onPlaced(0);
	}

	private unplace(id: string) {
		if (this.placed.delete(id)) this.h.onPlaced(this.placed.size);
	}

	/** Bring these ids into focus and blur the rest; null clears focus. */
	highlight(ids: string[] | null) {
		this.stage.classList.toggle("focusing", !!ids);
		this.live.forEach((l) => {
			const on = !!ids && ids.includes(l.card.id);
			l.el.classList.toggle("hl", on);
			l.wire.highlight(on);
		});
	}

	private sync(cards: FieldCard[]) {
		const seen = new Set<string>();
		cards.forEach((card) => {
			seen.add(card.id);
			const l = this.live.get(card.id);
			if (l) {
				if (
					l.card.title !== card.title ||
					l.card.content !== card.content ||
					l.card.meta !== card.meta ||
					l.card.kind !== card.kind ||
					l.card.scope !== card.scope ||
					l.card.previewUrl !== card.previewUrl
				)
					this.fill(l.el, card);
				l.card = card;
			} else this.addLive(card);
		});
		this.live.forEach((l, id) => {
			if (!seen.has(id)) this.removeLive(l);
		});
	}

	private fill(el: HTMLButtonElement, c: FieldCard) {
		el.setAttribute("aria-label", `${c.kind}: ${c.title}, ${c.content}`);
		el.innerHTML =
			'<div class="t"></div><div class="b"></div><div class="k"><i></i><em></em><span></span></div>';
		(el.querySelector("em") as HTMLElement).textContent = c.kind;
		(el.querySelector(".t") as HTMLElement).textContent = c.title;
		el.classList.toggle("document-card", c.layer === "retrieval");
		if (c.layer === "retrieval") {
			const title = el.querySelector(".t") as HTMLElement;
			title.textContent = c.title.split("/").at(-1) ?? c.title;
			title.title = c.title;
			if (c.previewUrl) {
				const cover = document.createElement("div");
				cover.className = "document-cover";
				const image = document.createElement("img");
				image.src = c.previewUrl;
				image.alt = c.previewLabel ?? c.title;
				image.loading = "lazy";
				image.draggable = false;
				image.addEventListener(
					"error",
					() => {
						image.remove();
						cover.classList.add("unavailable");
						cover.textContent =
							c.kind + " · " + (c.title.split(".").at(-1)?.toUpperCase() ?? "");
					},
					{ once: true },
				);
				cover.append(image);
				el.prepend(cover);
			}
		}
		const content = el.querySelector(".b") as HTMLElement;
		content.textContent = c.content.replace(/\*\*/g, "");
		if (c.layer === "retrieval") content.title = c.content;

		const m = el.querySelector(".k span") as HTMLElement;
		m.textContent = [c.scope, c.meta].filter(Boolean).join(" · ");
		m.classList.toggle("stale", c.stale);
	}

	private addLive(card: FieldCard) {
		const el = document.createElement("button");
		el.type = "button";
		el.className = "lens-card";
		el.style.setProperty("--c", layerColor(card.layer));
		el.style.width = this.CW + "px";
		this.fill(el, card);
		this.world.appendChild(el);
		const l: Live = {
			card,
			el,
			wire: new Wire(this.svg, {
				color: layerColor(card.layer),
				startDot: true,
				interactive: true,
			}),
			x: (this.W || this.stage.clientWidth) - this.CW - 20,
			y: 80,
			vx: 0,
			vy: 0,
			tx: 0,
			ty: 0,
			h: 80,
			small: false,
			deck: false,
			shelved: false,
			far: false,
			tight: false,
			seed: this.counter++,
		};
		l.h = el.offsetHeight || 80;
		this.live.set(card.id, l);
		this.bind(l);
	}

	private removeLive(l: Live) {
		l.el.remove();
		l.wire.remove();
		if (this.handleFor === l) this.hideHandle(true);
		this.live.delete(l.card.id);
	}

	private measure(m: FieldModel) {
		this.narrow = window.innerWidth <= 900;
		this.W = this.stage.clientWidth;
		this.H = this.stage.clientHeight;
		const cw = this.narrow ? Math.floor((this.W - 36) / 2) : CARD_W;
		if (cw !== this.CW) {
			this.CW = cw;
			this.live.forEach((l) => {
				l.el.style.width = cw + "px";
			});
		}
		this.live.forEach((l) => {
			if (!l.small && !l.tight) l.h = l.el.offsetHeight || l.h;
		});
		if (this.narrow) {
			this.tray = { x: 12, y: this.tray.y, w: this.W - 24, h: 92 };
		} else {
			// The drop zone sits in the bottom-right corner, sized for a small stack.
			const left = m.sheet.x + m.sheet.w + 48;
			const zw = Math.max(120, Math.min(this.CW + 24, this.W - 18 - left));
			this.tray = { x: this.W - 12 - zw, y: this.H - 162, w: zw, h: 150 };
		}
		Object.assign(this.zones.tray.style, {
			left: this.tray.x + "px",
			top: this.tray.y + "px",
			width: this.tray.w + "px",
			height: this.tray.h + "px",
		});
	}

	private targets(m: FieldModel) {
		const groups: Record<"in" | "near" | "ex" | "idle", Live[]> = {
			in: [],
			near: [],
			ex: [],
			idle: [],
		};
		const free: Live[] = [];
		this.live.forEach((l) => {
			const s = m.state[l.card.id] ?? "idle";
			const p = this.placed.get(l.card.id);
			if (p && p.state !== s) this.unplace(l.card.id);
			if (p && p.state === s && !this.narrow) free.push(l);
			else groups[s].push(l);
			l.small = false;
			l.deck = false;
			l.shelved = false;
			l.far = false;
			l.tight = false;
		});
		const shelfH = 36;
		// Closed shelf: its cards wait, hidden, behind the header.
		const shelve = (arr: Live[]) => {
			if (m.shelf) return false;
			arr.forEach((l) => {
				l.tx = this.shelf.x;
				l.ty = this.shelf.y;
				l.small = true;
				l.shelved = true;
			});
			return true;
		};
		const sortByOrder = (a: Live, b: Live) => a.seed - b.seed;
		if (this.narrow) {
			for (const c of CATEGORIES) this.head(c, null);
			const rowH =
				Math.max(80, ...[...this.live.values()].map((l) => l.h)) + 12;
			let y = m.floor + 16;
			const grid = (arr: Live[], step: number) => {
				arr.sort(sortByOrder).forEach((l, j) => {
					l.tx = 12 + (j % 2) * (this.CW + 12);
					l.ty = y + Math.floor(j / 2) * step;
					l.deck = true;
				});
				y += Math.ceil(arr.length / 2) * step + (arr.length ? 24 : 0);
			};
			grid(groups.in, rowH);
			grid(groups.near, rowH);
			this.shelf = groups.idle.length
				? { x: 12, y, w: this.W - 24, h: shelfH }
				: { x: 12, y, w: 0, h: 0 };
			if (groups.idle.length) y += shelfH + 12;
			if (!shelve(groups.idle)) grid(groups.idle, rowH * 0.62);
			y += 30;
			this.tray.y = y;
			const need = y + 92 + 30;
			if (Math.abs(this.stage.offsetHeight - need) > 6)
				this.stage.style.height = need + "px";
		} else {
			// Back from a phone width: the stage fills the window again.
			if (this.stage.style.height) this.stage.style.height = "";
			const colX = m.sheet.x + m.sheet.w + 48;
			const right = (m.fieldRight ?? this.W) - 18;
			const gap = 16;
			const step = this.CW + gap;
			const near = groups.near.sort(sortByOrder);
			const idle = groups.idle.sort(sortByOrder);

			// The side column holds what was not sent, against the right edge, so
			// spare width opens up between the two groups rather than past them. A
			// closed shelf is only a chip on the top row, so it takes no column.
			const cats = CATEGORIES.filter((c) =>
				groups.in.some((l) => l.card.layer === c),
			);
			const inNeed = Math.max(1, cats.length);
			const side = near.length > 0 || (m.shelf && idle.length > 0);
			const sideCols =
				!side || right - colX < 2 * step
					? 0
					: right - colX >= (inNeed + 2) * step + 32
						? 2
						: 1;
			const sideW = sideCols ? sideCols * step - gap : 0;
			const sideX = sideCols ? right - sideW : colX;
			const fit = Math.max(
				1,
				Math.floor(
					((sideCols ? sideX - gap : right) - colX + gap) / step + 0.05,
				),
			);
			// An empty drop zone is out of sight until a drag, so it holds no room.
			const bottomOf = (x: number) =>
				groups.ex.length && x + this.CW > this.tray.x
					? this.tray.y - 12
					: (m.fieldBottom ?? this.H) - 12;
			const limit = (c: number) => bottomOf(colX + c * step);
			const label = 22;
			const first = 84;
			const byAnchor = (a: Live, b: Live) =>
				(m.anchors[a.card.id]?.y ?? 0) - (m.anchors[b.card.id]?.y ?? 0);
			const parts = cats.map((layer) =>
				groups.in.filter((l) => l.card.layer === layer).sort(byAnchor),
			);
			const opens = new Set(parts.map((p) => p[0]));

			// Sent cards, memory nearest. Each kind starts a column of its own while
			// there are columns; one too long for its column carries on in the next.
			// With none left a kind joins the last column under its own label.
			const flow = () => {
				const columns: Live[][] = [[]];
				let y = first;
				let fits = true;
				for (const part of parts) {
					if (columns[columns.length - 1].length) {
						if (columns.length < fit) {
							columns.push([]);
							y = first;
						} else y += label;
					}
					for (const l of part) {
						const c = columns.length - 1;
						if (y + cardH(l) > limit(c) && columns[c].length) {
							if (columns.length < fit) {
								columns.push([]);
								y = first;
							} else fits = false;
						}
						columns[columns.length - 1].push(l);
						y += cardH(l) + CARD_GAP;
					}
				}
				return { columns, fits };
			};
			let placing = flow();
			// Only when the field truly cannot hold them whole do they fold to a title.
			// The choice reads natural heights, so folding cannot undo its own reason.
			if (!placing.fits) {
				for (const l of groups.in) l.tight = true;
				placing = flow();
			}
			for (const layer of CATEGORIES)
				if (!cats.includes(layer)) this.head(layer, null);
			placing.columns.forEach((col, c) => {
				if (!col.length) return;
				const x = colX + c * step;
				const lim = limit(c);
				const room = (l: Live) => (opens.has(l) && l !== col[0] ? label : 0);
				// A card sits level with its sentence and slides down past the one above...
				let bottom = first - CARD_GAP;
				for (const l of col) {
					const a = m.anchors[l.card.id];
					l.tx = x;
					l.far = c > 0;
					l.deck = true;
					l.ty = Math.max(
						first,
						(a ? a.y : this.H / 2) - cardH(l) / 2,
						bottom + CARD_GAP + room(l),
					);
					bottom = l.ty + cardH(l);
				}
				// ...and past the bottom, they close up from below, each only as far as it must.
				let ceiling = lim;
				for (const l of [...col].reverse()) {
					l.ty = Math.min(l.ty, ceiling - cardH(l));
					ceiling = l.ty - CARD_GAP - room(l);
				}
				// The last resort, for more cards than even their titles can stack.
				if (col[0].ty < first) {
					const labels = col.filter((l) => room(l) > 0).length * label;
					const st =
						(lim - first - labels - cardH(col[col.length - 1])) /
						Math.max(1, col.length - 1);
					let lift = 0;
					col.forEach((l, j) => {
						lift += room(l);
						l.ty = first + j * st + lift;
					});
				}
			});
			// Each label rides just above its group's top card.
			parts.forEach((p, k) => {
				this.head(
					cats[k],
					`${p[0].card.kind} ${p.length}`,
					p[0].tx,
					p[0].ty - label,
				);
			});

			// Near misses first, at full height: they are the ones worth reading.
			let y = sideCols
				? 62
				: Math.max(62, ...groups.in.map((l) => l.ty + cardH(l) + 14));
			const cols = Math.max(1, sideCols);
			if (near.length && y + near.length * (TIGHT_H + 12) > bottomOf(sideX)) {
				for (const l of near) l.tight = true;
			}
			near.forEach((l, j) => {
				l.tx = sideX + (j % cols) * step;
				l.ty = y + Math.floor(j / cols) * (cardH(l) + 12);
				l.deck = true;
			});
			y += near.length
				? Math.ceil(near.length / cols) *
						(Math.max(...near.map((l) => l.h)) + 12) +
					8
				: 0;
			// The shelf is a chip on the field's top row, at the far right.
			const shelfW = this.zones.shelf.offsetWidth || 130;
			this.shelf = idle.length
				? { x: right - shelfW, y: 12, w: shelfW, h: shelfH }
				: { x: right, y: 12, w: 0, h: 0 };
			if (!shelve(idle)) {
				const rows: Live[][] = Array.from({ length: cols }, () => []);
				idle.forEach((l, j) => {
					rows[j % cols].push(l);
				});
				const lim = bottomOf(right - this.CW);
				const tall = (row: Live[]) =>
					row.reduce((sum, l) => sum + cardH(l) + CARD_GAP, -CARD_GAP);
				if (Math.max(...rows.map(tall)) > lim - y)
					for (const l of idle) l.tight = true;
				rows.forEach((row, c) => {
					// Still too many: they overlap evenly rather than run off the bottom.
					const st = Math.min(
						TIGHT_H + CARD_GAP,
						(lim - y - TIGHT_H) / Math.max(1, row.length - 1),
					);
					let top = y;
					row.forEach((l, j) => {
						l.tx = sideX + c * step;
						l.ty = l.tight ? y + j * st : top;
						top += cardH(l) + CARD_GAP;
						l.deck = true;
					});
				});
			}
		}
		// What was left out, folded to its title and listed in the tray, at the tray's scale. Past what
		// the tray can list they overlap evenly; on phones the tray is a row, so they sit side by side.
		const stack = (arr: Live[], z: Rect) =>
			arr.sort(sortByOrder).forEach((l, j) => {
				const sw = this.CW * 0.86;
				const sh = TIGHT_H * 0.86;
				l.small = true;
				l.tight = true;
				if (this.narrow) {
					const room = z.w - 20 - sw;
					const st =
						arr.length > 1 ? Math.min(sw + 8, room / (arr.length - 1)) : 0;
					l.tx = z.x + 10 + j * st;
					l.ty = z.y + 30;
				} else {
					const room = z.h - 38 - sh;
					const st =
						arr.length > 1 ? Math.min(sh + 6, room / (arr.length - 1)) : 0;
					l.tx = z.x + (z.w - sw) / 2;
					l.ty = z.y + 30 + j * st;
				}
			});
		stack(groups.ex, this.tray);
		// An empty drop zone stays out of sight until a card is being dragged.
		this.zones.tray.classList.toggle("empty", groups.ex.length === 0);
		// A folded card opens over its neighbours when asked about: keep it on screen.
		if (!this.narrow)
			this.live.forEach((l) => {
				if (
					l.tight &&
					(l.el.classList.contains("hl") || l.el.matches(":hover"))
				)
					l.ty = Math.min(l.ty, this.H - 12 - l.h * (l.small ? 0.86 : 1));
			});
		for (const l of free) {
			const p = this.placed.get(l.card.id)!;
			l.tx = p.x;
			l.ty = p.y;
		}
		const z = this.zones.shelf;
		z.hidden = this.shelf.w === 0;
		Object.assign(z.style, {
			left: this.shelf.x + "px",
			top: this.shelf.y + "px",
			// Narrow screens: a full row. Otherwise it sizes to its label.
			width: this.narrow ? this.shelf.w + "px" : "",
		});
	}

	private frame() {
		const m = this.h.model();
		this.sync(m.cards);
		this.measure(m);
		this.targets(m);
		const rm = reduced();
		const K = rm ? 1 : 0.09;
		const D = rm ? 0 : 0.76;
		// Wires leaving the same sentence fan out a few pixels apart, ordered by
		// where their cards sit, so they start side by side and never cross there.
		const spread = new Map<string, number>();
		const shared = new Map<string, Live[]>();
		this.live.forEach((l) => {
			const a = m.anchors[l.card.id];
			if (!a || m.state[l.card.id] !== "in") return;
			const key = `${Math.round(a.x)},${Math.round(a.y)}`;
			shared.set(key, [...(shared.get(key) ?? []), l]);
		});
		shared.forEach((ls) => {
			ls.sort((p, q) => p.ty - q.ty);
			ls.forEach((l, i) => {
				spread.set(l.card.id, (i - (ls.length - 1) / 2) * 5);
			});
		});
		this.live.forEach((l) => {
			const s = m.state[l.card.id] ?? "idle";
			if (!(this.drag && this.drag.l === l)) {
				if (rm) {
					l.x = l.tx;
					l.y = l.ty;
				}
				l.vx = (l.vx + (l.tx - l.x) * K) * D;
				l.vy = (l.vy + (l.ty - l.y) * K) * D;
				l.x += l.vx;
				l.y += l.vy;
				l.el.style.transform = `translate(${l.x}px, ${l.y}px) scale(${l.small ? 0.86 : 1})`;
			}
			for (const k of ["in", "near", "ex", "idle"])
				l.el.classList.toggle(k, s === k);
			l.el.classList.toggle("pin", s === "in" && m.pinned.has(l.card.id));
			l.el.classList.toggle("shelved", l.shelved);
			l.el.classList.toggle("tight", l.tight);
			l.el.tabIndex = l.shelved ? -1 : 0;
			const a = m.anchors[l.card.id];
			const on = s === "in" && !!a && !this.narrow;
			l.wire.setVisible(on);
			if (!on) {
				if (this.handleFor === l) this.hideHandle(true);
				return;
			}
			const ex = l.x;
			const ey = l.y + cardH(l) / 2;
			const o = spread.get(l.card.id) ?? 0;
			const ax = a.kind === "strip" ? a.x + o : a.x;
			const ay = a.kind === "strip" ? a.y : a.y + o;
			// Across the open field a wire is a curve. A strip's wire first has to leave the sheet: up
			// off its segment, along the gap above the strip, out of the edge. Only the part over the
			// field can be grabbed, so it never covers the input.
			const sx = a.kind === "strip" ? m.sheet.x + m.sheet.w : ax;
			const sy = a.kind === "strip" ? ay - RAIL : ay;
			l.wire.move(
				(sx - this.view.x) / this.view.scale,
				(sy - this.view.y) / this.view.scale,
				ex,
				ey,
				a.kind === "strip"
					? {
							x: (ax - this.view.x) / this.view.scale,
							y: (ay - this.view.y) / this.view.scale,
						}
					: undefined,
			);
			l.wire.dim(l.far, !!a.fade);
			if (this.handleFor === l && l.wire.hit) {
				const p = l.wire.hit.getPointAtLength(
					l.wire.hit.getTotalLength() * 0.5,
				);
				this.handle.style.transform = `translate(${p.x - 13}px, ${p.y - 13}px)`;
			}
		});
	}

	private local(e: PointerEvent): [number, number] {
		const b = this.world.getBoundingClientRect();
		return [
			(e.clientX - b.left) / this.view.scale,
			(e.clientY - b.top) / this.view.scale,
		];
	}

	private bind(l: Live) {
		const el = l.el;
		const inRect = (x: number, y: number, r: Rect | null) =>
			!!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
		el.addEventListener("pointerdown", (e) => {
			if (e.button > 0) return;
			const [x, y] = this.local(e);
			this.drag = {
				l,
				ox: x - l.x,
				oy: y - l.y,
				sx: x,
				sy: y,
				moved: false,
			};
			el.setPointerCapture(e.pointerId);
		});
		el.addEventListener("pointermove", (e) => {
			const d = this.drag;
			if (!d || d.l !== l) return;
			const [x, y] = this.local(e);
			if (!d.moved && Math.hypot(x - d.sx, y - d.sy) > 5) {
				d.moved = true;
				el.classList.add("drag");
				this.stage.classList.add("dragging");
				l.small = false;
			}
			if (!d.moved) return;
			l.x = x - d.ox;
			l.y = y - d.oy;
			el.style.transform = `translate(${l.x}px, ${l.y}px)`;
			const m = this.h.model();
			this.stage.classList.toggle(
				"over-composer",
				inRect(
					this.view.x + x * this.view.scale,
					this.view.y + y * this.view.scale,
					m.form,
				),
			);
			this.zones.tray.classList.toggle("over", inRect(x, y, this.tray));
		});
		const end = (e: PointerEvent) => {
			const d = this.drag;
			if (!d || d.l !== l) return;
			this.drag = null;
			el.classList.remove("drag");
			this.stage.classList.remove("dragging");
			this.stage.classList.remove("over-composer");
			this.zones.tray.classList.remove("over");
			if (!d.moved) return;
			// The card left the pointer, so no mouseleave will clear its focus.
			this.h.onHover(null);
			this.suppressClick = true;
			setTimeout(() => {
				this.suppressClick = false;
			}, 0);
			const [x, y] = this.local(e);
			const m = this.h.model();
			const s = m.state[l.card.id] ?? "idle";
			let target: DropTarget = "none";
			if (
				inRect(
					this.view.x + x * this.view.scale,
					this.view.y + y * this.view.scale,
					m.form,
				)
			)
				target = "composer";
			else if (inRect(x, y, this.tray)) target = "tray";
			if (target === "none" && s !== "ex" && !this.narrow) {
				// Open field: the card stays where you put it, inside the stage.
				this.placed.set(l.card.id, {
					x: l.x,
					y: l.y,
					state: s,
				});
				this.h.onPlaced(this.placed.size);
			} else this.unplace(l.card.id);
			this.h.onDrop(l.card.id, target, s);
		};
		el.addEventListener("pointerup", end);
		el.addEventListener("pointercancel", () => {
			if (this.drag?.l === l) {
				this.drag = null;
				el.classList.remove("drag");
			}
		});
		el.addEventListener("click", () => {
			if (!this.suppressClick) this.h.onClick(l.card.id);
		});
		el.addEventListener("dblclick", () => this.unplace(l.card.id));
		el.addEventListener("mouseenter", () => {
			if (!this.drag) this.h.onHover(l.card.id);
		});
		el.addEventListener("mouseleave", () => this.h.onHover(null));
		l.wire.hit?.addEventListener("mouseenter", () => {
			if (!this.drag) this.showHandle(l);
		});
		l.wire.hit?.addEventListener("mouseleave", () => this.hideHandle());
		l.wire.hit?.addEventListener("click", () => this.showHandle(l));
	}

	private showHandle(l: Live) {
		clearTimeout(this.hideT);
		this.handleFor = l;
		this.handle.hidden = false;
		this.handle.title = l.card.unlink;
		this.handle.setAttribute("aria-label", l.card.unlink);
		this.h.onHover(l.card.id);
	}

	private hideHandle(now = false) {
		clearTimeout(this.hideT);
		const go = () => {
			this.handle.hidden = true;
			this.handleFor = null;
			this.h.onHover(null);
		};
		if (now) go();
		else this.hideT = setTimeout(go, 260);
	}
}
