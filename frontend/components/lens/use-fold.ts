import { useLayoutEffect, useRef } from "react";

/** Folds a header row one step at a time while it would wrap: text buttons to icons (`data-fold="1"`),
 *  then the wordmark to its mark (`"2"`). Measured, not guessed from a breakpoint, because the same row
 *  is far wider in English than in Chinese, and a situation's name can be any length. `content` names
 *  what the row shows, so a change to it measures again; width changes are watched. */
export function useFold<T extends HTMLElement>(content: string) {
	const ref = useRef<T>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: content is read through the DOM
	useLayoutEffect(() => {
		const row = ref.current;
		if (!row) return;
		const wraps = () => {
			const kids = [...row.children] as HTMLElement[];
			// Items on one line are centred, so their tops differ; a wrapped one starts below them all.
			const bottom = Math.min(...kids.map((k) => k.offsetTop + k.offsetHeight));
			return kids.some((k) => k.offsetTop >= bottom);
		};
		const check = () => {
			for (const level of ["", "1", "2"]) {
				if (level) row.dataset.fold = level;
				else delete row.dataset.fold;
				if (!wraps()) return;
			}
		};
		check();
		// Folding resizes the row itself; doing it a frame later keeps the observer out of a loop.
		let frame = 0;
		let width = row.clientWidth;
		const ro = new ResizeObserver(() => {
			if (row.clientWidth === width) return;
			width = row.clientWidth;
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(check);
		});
		ro.observe(row);
		return () => {
			ro.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [content]);
	return ref;
}
