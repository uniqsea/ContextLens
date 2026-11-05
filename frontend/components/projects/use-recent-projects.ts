import { useEffect, useState } from "react";
import { ORDINARY } from "@/lib/projects/types";

const KEY = "contextlens.recent-projects";

export function useRecentProjects(scope?: string) {
	const [recent, setRecent] = useState<string[]>([]);
	useEffect(() => {
		try {
			const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
			const ids: string[] = Array.isArray(stored)
				? stored.filter((id) => typeof id === "string")
				: [];
			if (scope && scope !== ORDINARY) {
				const next = [scope, ...ids.filter((id) => id !== scope)].slice(0, 5);
				localStorage.setItem(KEY, JSON.stringify(next));
				setRecent(next);
			} else {
				setRecent(ids);
			}
		} catch {
			// The project directory still works when browser storage is unavailable.
		}
	}, [scope]);
	return recent;
}
