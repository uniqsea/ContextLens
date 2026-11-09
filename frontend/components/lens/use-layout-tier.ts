"use client";

import { type RefObject, useLayoutEffect, useState } from "react";
import { spacingUnit } from "@/lib/density";

/**
 * How much room the conversation page has, which decides its layout.
 * - stacked: phone widths; everything in one column (the window is the measure, as in the CSS).
 * - medium: conversation and canvas side by side; the sources open as a drawer over the canvas.
 * - wide: conversation, canvas and sources in three columns.
 * The stage is measured rather than the window, so a side tab bar counts against the room.
 * The threshold is in spacing units, so a compact interface fits three columns sooner.
 */
export type LayoutTier = "stacked" | "medium" | "wide";

export const STACKED_QUERY = "(max-width: 900px)";
// 1600px at standard density: a 14-inch laptop (1512 wide) falls to medium there, as three columns
// leave the canvas too little; compact (1400px) fits them.
const WIDE_MIN_UNITS = 400;

function tierOf(stage: HTMLElement): LayoutTier {
	if (window.matchMedia(STACKED_QUERY).matches) return "stacked";
	return stage.clientWidth >= WIDE_MIN_UNITS * spacingUnit()
		? "wide"
		: "medium";
}

export function useLayoutTier(stageRef: RefObject<HTMLElement | null>) {
	const [tier, setTier] = useState<LayoutTier>("wide");
	useLayoutEffect(() => {
		const stage = stageRef.current;
		if (!stage) return;
		const update = () => setTier(tierOf(stage));
		update();
		const observer = new ResizeObserver(update);
		observer.observe(stage);
		const query = window.matchMedia(STACKED_QUERY);
		query.addEventListener("change", update);
		const density = new MutationObserver(update);
		density.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-density"],
		});
		return () => {
			density.disconnect();
			observer.disconnect();
			query.removeEventListener("change", update);
		};
	}, [stageRef]);
	return tier;
}
