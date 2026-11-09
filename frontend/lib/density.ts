/**
 * Interface density. Every length on the page is a multiple of one unit, Tailwind's `--spacing`,
 * and the type sizes are role tokens (`--type-*`); a density is one set of values for both,
 * defined in globals.css under `html[data-density]`. People choose it in Settings; until they do,
 * a laptop-sized screen starts compact. It is the screen that decides, not the window, so the page
 * does not change size as a window is resized.
 */
export type Density = "standard" | "compact";

export const DENSITY_KEY = "contextlens.density";
/** Screens narrower than this start compact. */
const COMPACT_BELOW = 1600;

export function storedDensity(): Density | null {
	try {
		const v = localStorage.getItem(DENSITY_KEY);
		return v === "standard" || v === "compact" ? v : null;
	} catch {
		return null;
	}
}

export function defaultDensity(): Density {
	return window.screen.width < COMPACT_BELOW ? "compact" : "standard";
}

/** Runs in <head> before the first paint, so the page never draws at one density and jumps to another. */
export const DENSITY_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(DENSITY_KEY)});if(v!=="standard"&&v!=="compact")v=screen.width<${COMPACT_BELOW}?"compact":"standard";document.documentElement.dataset.density=v}catch(e){}})()`;

let unitPx: number | null = null;
let watching = false;

/** The spacing unit in pixels at the current density, for layout done in script (the canvas). */
export function spacingUnit(): number {
	if (unitPx === null) {
		const probe = document.createElement("div");
		probe.style.cssText =
			"position:absolute;visibility:hidden;width:calc(var(--spacing) * 100)";
		document.body.appendChild(probe);
		unitPx = probe.getBoundingClientRect().width / 100 || 4;
		probe.remove();
	}
	if (!watching) {
		watching = true;
		new MutationObserver(() => {
			unitPx = null;
		}).observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-density"],
		});
	}
	return unitPx;
}
