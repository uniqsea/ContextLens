import { createContext, useContext, useEffect, useState } from "react";
import type { Directory } from "@/lib/projects/types";

export function useDirectory(scope?: string, view?: "search") {
	const [loaded, setLoaded] = useState<{
		scope?: string;
		data: Directory;
	} | null>(null);
	const [failed, setFailed] = useState(false);
	const [revision, setRevision] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision requests a fresh directory after a write
	useEffect(() => {
		const controller = new AbortController();
		setFailed(false);
		async function load() {
			const params = new URLSearchParams(scope ? { scope } : {});
			if (view) params.set("view", view);
			const response = await fetch(`/api/project-directory?${params}`, {
				signal: controller.signal,
				cache: "no-store",
			});
			if (!response.ok) throw new Error("Directory could not be loaded");
			const result: Directory = await response.json();
			if (!controller.signal.aborted) setLoaded({ scope, data: result });
		}
		load().catch(() => {
			if (!controller.signal.aborted) setFailed(true);
		});
		return () => controller.abort();
	}, [scope, view, revision]);
	return {
		data: loaded && loaded.scope === scope ? loaded.data : null,
		projects: loaded?.data.projects ?? [],
		failed,
		reload: () => setRevision((v) => v + 1),
	};
}

export const DirectoryContext = createContext<ReturnType<
	typeof useDirectory
> | null>(null);

export function useWorkspaceDirectory() {
	const directory = useContext(DirectoryContext);
	if (!directory) throw new Error("Workspace layout is required");
	return directory;
}
