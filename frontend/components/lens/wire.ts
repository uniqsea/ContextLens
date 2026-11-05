import "./wire.css";

// A DOM-backed component so the spring animation can move endpoints without a React render.
const svgNS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(name: K) {
	return document.createElementNS(svgNS, name);
}

interface WireOptions {
	color: string;
	startDot?: boolean;
	endArrow?: boolean;
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

export class Wire {
	private readonly group = svg("g");
	private readonly stroke = svg("path");
	private readonly dot: SVGCircleElement | null;
	readonly hit: SVGPathElement | null;

	constructor(parent: SVGElement, options: WireOptions) {
		this.group.setAttribute("class", "lens-wire");
		this.group.style.setProperty("--c", options.color);
		this.stroke.setAttribute("class", "wire");
		this.hit = options.interactive ? svg("path") : null;
		this.dot = options.startDot ? svg("circle") : null;
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
		parent.append(this.group);
	}

	remove() {
		this.group.remove();
	}

	setVisible(visible: boolean) {
		this.group.style.display = visible ? "" : "none";
	}

	move(
		x: number,
		y: number,
		endX: number,
		endY: number,
		rail?: { x: number; y: number },
	) {
		const dx = endX - x;
		const curve = `C${x + dx * 0.5} ${y} ${endX - dx * 0.5} ${endY} ${endX} ${endY}`;
		const open = `M${x} ${y} ${curve}`;
		this.stroke.setAttribute(
			"d",
			rail
				? `M${rail.x} ${rail.y} V${y + 5} Q${rail.x} ${y} ${rail.x + 5} ${y} H${x} ${curve}`
				: open,
		);
		this.hit?.setAttribute("d", open);
		this.dot?.setAttribute("cx", String(rail?.x ?? x));
		this.dot?.setAttribute("cy", String(rail?.y ?? y));
		this.stroke.classList.toggle("preview", !!rail);
	}

	// Follow the empty gutters around a wrapped row, keeping the arrow outside the cards.
	moveAcrossRow(x: number, y: number, endX: number, endY: number, gutterY: number) {
		const path = `M${x} ${y} h10 V${gutterY} H${endX - 10} V${endY} H${endX}`;
		this.stroke.setAttribute("d", path);
		this.hit?.setAttribute("d", path);
	}

	highlight(active: boolean) {
		this.stroke.classList.toggle("hl", active);
		this.dot?.classList.toggle("hl", active);
	}

	dim(far: boolean, fade: boolean) {
		this.stroke.classList.toggle("far", far);
		this.stroke.style.opacity = fade ? "0.12" : "";
	}

	snap() {
		const cut = svg("path");
		cut.setAttribute("class", "lens-wire-snap");
		cut.setAttribute("d", this.stroke.getAttribute("d") ?? "");
		this.group.parentNode?.appendChild(cut);
		setTimeout(() => cut.remove(), 520);
	}
}
