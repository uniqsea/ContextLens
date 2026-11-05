import type { LensState, Snapshot } from "./types";

export const ASSISTANT_ID =
	process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID || "context_agent";

export function apiUrl(): string {
	return typeof window === "undefined"
		? "http://localhost/api"
		: new URL("/api", window.location.href).href;
}

export interface Draft {
	excluded: string[];
	inputOrder: string[] | null;
}

/** What the next request would carry, computed by the agent without calling a model. */
export async function previewContext(
	state: LensState | undefined,
	query: string,
	projectId: string | null,
	draft: Draft,
): Promise<Snapshot> {
	const res = await fetch("/api/lens/preview", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			messages: [...(state?.messages ?? []), { type: "human", content: query }],
			history_lineage: state?.history_lineage ?? {},
			project_id: projectId,
			context_policies: draft.excluded.map((id) => ({
				item_id: id,
				status: "temporarily_ignored",
			})),
			input_order: draft.inputOrder,
		}),
	});
	if (!res.ok) throw new Error(`Preview failed (${res.status})`);
	return (await res.json()) as Snapshot;
}
