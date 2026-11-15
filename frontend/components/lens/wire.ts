import "./wire.css";

// A DOM-backed component so the spring animation can move endpoints without a React render.
const svgNS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(name: K) {
	return document.createElementNS(svgNS, name);
}

interface WireOptions {
	color: string;
	startDot?: boolean;
	/** The mark where the wire meets its card: one outline per kind of source. */
	endMark?: keyof typeof MARKS;
	endArrow?: boolean;
	/** A neutral wire: ink at rest, its colour only when highlighted. */
	ink?: boolean;
	interactive?: boolean;
}

// One definition per SVG layer, shared by every directed edge in that layer.
function arrowMarker(parent: SVGElement) {
	let marker = parent.querySelector<SVGMarkerElement>(
		":scope > defs > marker[data-wire-arrow]",
	);
	if (marker) return marker.id;
	const defs = svg("defs");
	marker = svg("marker");
	marker.id = `wire-arrow-${crypto.randomUUID()}`;
	marker.dataset.wireArrow = "";
	marker.setAttribute("viewBox", "0 0 8 8");
	marker.setAttribute("refX", "7");
	marker.setAttribute("refY", "4");
	marker.setAttribute("markerWidth", "6");
	marker.setAttribute("markerHeight", "6");
	marker.setAttribute("orient", "auto");
	const tip = svg("path");
	tip.setAttribute("d", "M0 0 L8 4 L0 8 z");
	tip.setAttribute("fill", "context-stroke");
	marker.append(tip);
	defs.append(marker);
	parent.prepend(defs);
	return marker.id;
}

/* Drawn about the origin and moved into place, so a mark never has to be redrawn. */
const MARKS = {
	dot: "M-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0",
	square: "M-4-4h8v8h-8z",
	diamond: "M0-5.5 5.5 0 0 5.5-5.5 0z",
};

export class Wire {
	private readonly group = svg("g");
	private readonly stroke = svg("path");
	private readonly dot: SVGCircleElement | null;
	private readonly end: SVGPathElement | null;
	readonly hit: SVGPathElement | null;

	constructor(parent: SVGElement, options: WireOptions) {
		this.group.setAttribute(
			"class",
			options.ink ? "lens-wire ink" : "lens-wire",
		);
		this.group.style.setProperty("--c", options.color);
		this.stroke.setAttribute("class", "wire");
		this.hit = options.interactive ? svg("path") : null;
		this.dot = options.startDot ? svg("circle") : null;
		this.end = options.endMark ? svg("path") : null;
		if (this.hit) {
			this.hit.setAttribute("class", "hit");
			this.group.append(this.hit);
		}
		this.group.append(this.stroke);
		if (options.endArrow)
			this.stroke.setAttribute("marker-end", `url(#${arrowMarker(parent)})`);
		if (this.dot) {
			this.dot.setAttribute("class", "dot");
			this.dot.setAttribute("r", "3");
			this.group.append(this.dot);
		}
		if (this.end) {
			this.end.setAttribute("class", "dot end");
			this.end.setAttribute("d", MARKS[options.endMark ?? "dot"]);
			this.group.append(this.end);
		}
		parent.append(this.group);
	}

	remove() {
		this.group.remove();
	}

	setVisible(visible: boolean) {
		this.group.style.display = visible ? "" : "none";
	}

	/**
	 * From (x, y) to the end. `lead` is where the wire really starts when it first has to reach
	 * (x, y): a sentence, on its way through its segment of the spine. Only the main run can be
	 * grabbed. `preview` draws it dashed: nothing has been sent yet.
	 */
	move(
		x: number,
		y: number,
		endX: number,
		endY: number,
		options?: {
			lead?: { x: number; y: number; toX: number };
			preview?: boolean;
		},
	) {
		const curve = (x1: number, y1: number, x2: number, y2: number) => {
			const dx = x2 - x1;
			return `M${x1} ${y1} C${x1 + dx * 0.5} ${y1} ${x2 - dx * 0.5} ${y2} ${x2} ${y2}`;
		};
		const lead = options?.lead;
		const open = curve(x, y, endX, endY);
		this.stroke.setAttribute(
			"d",
			lead ? `${curve(lead.x, lead.y, lead.toX, y)} ${open}` : open,
		);
		this.hit?.setAttribute("d", open);
		if (this.dot) {
			this.dot.setAttribute("cx", String(lead?.x ?? x));
			this.dot.setAttribute("cy", String(lead?.y ?? y));
			// A previewed wire starts on the spine itself, which needs no mark.
			this.dot.style.display = options?.preview ? "none" : "";
		}
		this.end?.setAttribute("transform", `translate(${endX} ${endY})`);
		this.stroke.classList.toggle("preview", !!options?.preview);
	}

	highlight(active: boolean) {
		this.stroke.classList.toggle("hl", active);
		this.dot?.classList.toggle("hl", active);
		this.end?.classList.toggle("hl", active);
	}

	dim(far: boolean, fade: boolean) {
		this.stroke.classList.toggle("far", far);
		this.stroke.style.opacity = fade ? "0.12" : "";
		if (this.dot) this.dot.style.opacity = fade ? "0.12" : "";
	}

	snap() {
		const cut = svg("path");
		cut.setAttribute("class", "lens-wire-snap");
		cut.setAttribute("d", this.stroke.getAttribute("d") ?? "");
		this.group.parentNode?.appendChild(cut);
		setTimeout(() => cut.remove(), 520);
	}
}
