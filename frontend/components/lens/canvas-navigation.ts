/** Coordinates are CSS pixels relative to the viewport's top-left corner. */
export interface CanvasView {
	x: number;
	y: number;
	scale: number;
}

export function bindCanvasNavigation(
	viewport: HTMLElement,
	accept: (target: EventTarget | null, pan: boolean) => boolean,
	render: (view: CanvasView) => void,
) {
	const listeners = new AbortController();
	const options = { signal: listeners.signal };
	let view: CanvasView = { x: 0, y: 0, scale: 1 };
	const touches = new Map<number, { x: number; y: number }>();
	const point = (e: MouseEvent) => {
		const box = viewport.getBoundingClientRect();
		return { x: e.clientX - box.left, y: e.clientY - box.top };
	};
	function move(x: number, y: number, scale = view.scale) {
		view = { x, y, scale };
		render(view);
	}
	function zoom(x: number, y: number, factor: number, dx = 0, dy = 0) {
		const scale = Math.min(
			4,
			Math.max(Math.min(0.25, view.scale), view.scale * factor),
		);
		const ratio = scale / view.scale;
		move(x + dx - (x - view.x) * ratio, y + dy - (y - view.y) * ratio, scale);
	}
	viewport.addEventListener(
		"wheel",
		(e) => {
			if (!accept(e.target, false) || !e.deltaY) return;
			e.preventDefault();
			const { x, y } = point(e);
			const unit =
				e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1;
			zoom(x, y, Math.exp(-e.deltaY * unit * 0.002));
		},
		{ ...options, passive: false },
	);
	viewport.addEventListener(
		"pointerdown",
		(e) => {
			if (e.button !== 0 || !accept(e.target, true) || touches.size >= 2)
				return;
			viewport.focus({ preventScroll: true });
			viewport.setPointerCapture(e.pointerId);
			touches.set(e.pointerId, point(e));
			viewport.dataset.panning = "true";
		},
		options,
	);
	viewport.addEventListener(
		"pointermove",
		(e) => {
			const prev = touches.get(e.pointerId);
			if (!prev) return;
			const next = point(e);
			touches.delete(e.pointerId);
			const other = touches.values().next().value;
			touches.set(e.pointerId, next);
			const dx = next.x - prev.x;
			const dy = next.y - prev.y;
			if (!other) {
				move(view.x + dx, view.y + dy);
				return;
			}
			const before = Math.hypot(prev.x - other.x, prev.y - other.y);
			if (before < 1) return;
			const after = Math.hypot(next.x - other.x, next.y - other.y);
			zoom(
				(prev.x + other.x) / 2,
				(prev.y + other.y) / 2,
				after / before,
				dx / 2,
				dy / 2,
			);
		},
		options,
	);
	const finish = (e: PointerEvent) => {
		touches.delete(e.pointerId);
		if (!touches.size) delete viewport.dataset.panning;
	};
	viewport.addEventListener("lostpointercapture", finish, options);
	viewport.addEventListener("pointercancel", finish, options);
	viewport.addEventListener(
		"dblclick",
		(e) => {
			if (accept(e.target, true)) move(0, 0, 1);
		},
		options,
	);
	viewport.addEventListener(
		"keydown",
		(e) => {
			if (e.target !== viewport || e.ctrlKey || e.metaKey || e.altKey) return;
			switch (e.key) {
				case "ArrowLeft":
					move(view.x + 40, view.y);
					break;
				case "ArrowRight":
					move(view.x - 40, view.y);
					break;
				case "ArrowUp":
					move(view.x, view.y + 40);
					break;
				case "ArrowDown":
					move(view.x, view.y - 40);
					break;
				case "+":
				case "=":
				case "-":
					zoom(
						viewport.clientWidth / 2,
						viewport.clientHeight / 2,
						e.key === "-" ? 0.8 : 1.25,
					);
					break;
				case "0":
					move(0, 0, 1);
					break;
				default:
					return;
			}
			e.preventDefault();
		},
		options,
	);
	return { move, zoom, destroy: () => listeners.abort() };
}
