import { useEffect, useState } from "react";
import type { Directory } from "@/lib/projects/types";

export function useDirectory(scope?: string) {
	const [data, setData] = useState<Directory | null>(null);
	const [failed, setFailed] = useState(false);
	const [revision, setRevision] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision requests a fresh directory after a write
	useEffect(() => {
		const controller = new AbortController();
		setFailed(false);
		async function load() {
			const params = new URLSearchParams(scope ? { scope } : {});
			const response = await fetch(`/api/project-directory?${params}`, {
				signal: controller.signal,
				cache: "no-store",
			});
			if (!response.ok) throw new Error("Directory could not be loaded");
			const result: Directory = await response.json();
			if (!controller.signal.aborted) setData(result);
		}
		load().catch(() => {
			if (!controller.signal.aborted) setFailed(true);
		});
		return () => controller.abort();
	}, [scope, revision]);
	return { data, failed, reload: () => setRevision((v) => v + 1) };
}
