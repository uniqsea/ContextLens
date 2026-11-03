"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	type ModelInfo,
	type Overview,
	settingsApi,
} from "@/lib/model-settings";

/** The model settings as the agent holds them, plus a cached model list per provider. */
export function useModelSettings() {
	const [overview, setOverview] = useState<Overview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const modelCache = useRef(new Map<string, Promise<ModelInfo[]>>());
	// Bumped when a provider's model list changes, so views built from it reload.
	const [modelsVersion, setModelsVersion] = useState(0);

	const run = useCallback(async (work: () => Promise<Overview>) => {
		try {
			setOverview(await work());
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, []);
	useEffect(() => {
		run(settingsApi.overview);
	}, [run]);

	const loadModels = useCallback((provider: string) => {
		let list = modelCache.current.get(provider);
		if (!list) {
			list = settingsApi.models(provider);
			// A failed load is retried next time instead of being cached.
			list.catch(() => modelCache.current.delete(provider));
			modelCache.current.set(provider, list);
		}
		return list;
	}, []);

	const setShown = useCallback(
		async (provider: string, models: string[] | null) => {
			try {
				const list = await settingsApi.setShown(provider, models);
				modelCache.current.set(provider, Promise.resolve(list));
				setModelsVersion((v) => v + 1);
				setError(null);
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			}
		},
		[],
	);

	return { overview, error, run, loadModels, modelsVersion, setShown };
}

export type ModelSettings = ReturnType<typeof useModelSettings>;
