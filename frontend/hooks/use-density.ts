"use client";

import { useCallback, useEffect, useState } from "react";
import {
	DENSITY_KEY,
	type Density,
	defaultDensity,
	storedDensity,
} from "@/lib/density";

/** The interface density and a setter that applies and remembers it (see lib/density.ts). */
export function useDensity() {
	const [density, setState] = useState<Density>("standard");
	useEffect(() => {
		setState(storedDensity() ?? defaultDensity());
	}, []);
	const setDensity = useCallback((d: Density) => {
		setState(d);
		document.documentElement.dataset.density = d;
		try {
			localStorage.setItem(DENSITY_KEY, d);
		} catch {}
	}, []);
	return [density, setDensity] as const;
}
