"use client";

import { useCallback, useEffect, useState } from "react";
import { memoryApi } from "@/lib/memory-api";
import type { Overview } from "@/lib/memory-types";

/** What surrounds the memories of a scope; `reload` after anything that may have changed it. */
export function useOverview(scope: string) {
	const [data, setData] = useState<Overview | null>(null);
	const [version, setVersion] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: version is the reload trigger
	useEffect(() => {
		let live = true;
		memoryApi
			.overview(scope)
			.then((next) => {
				if (live) setData(next);
			})
			.catch(() => {
				/* the agent may still be starting; the next reload catches up */
			});
		return () => {
			live = false;
		};
	}, [scope, version]);
	const reload = useCallback(() => setVersion((v) => v + 1), []);
	return { data, reload };
}
