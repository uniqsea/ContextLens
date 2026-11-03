"use client";

import { useCallback, useEffect, useState } from "react";

const SCOPE_KEY = "contextlens.scope";
export const ORDINARY = "ordinary";

/** Where the user is working: ordinary sessions or a project. The conversation and the library
 * share it, so it lives in the browser rather than in either page. */
export function useScope() {
	const [scope, setScope] = useState(ORDINARY);
	useEffect(() => {
		try {
			setScope(localStorage.getItem(SCOPE_KEY) ?? ORDINARY);
		} catch {
			/* storage unavailable: stay in ordinary sessions */
		}
	}, []);
	const chooseScope = useCallback((next: string) => {
		setScope(next);
		try {
			localStorage.setItem(SCOPE_KEY, next);
		} catch {
			/* storage unavailable: the choice lasts until reload */
		}
	}, []);
	return { scope, chooseScope, projectId: scope === ORDINARY ? null : scope };
}
