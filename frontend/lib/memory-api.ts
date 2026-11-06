/** Client for the agent's memory library (/lens/memories, reached through the same-origin proxy).
 * Every change goes through the agent's governance and comes back as an event that can be undone. */
import type {
	ImportCandidate,
	MemoryEvent,
	MemoryRecord,
	MemoryType,
	Overview,
	Project,
	SuggestedSituation,
	TimelineFact,
} from "./memory-types";

const BASE = "/api/lens";

export interface MemoryFields {
	title: string;
	content: string;
	memory_type?: MemoryType;
	scenes?: string[];
	concepts?: string[];
	always_on?: boolean;
}

export interface ChangeResult {
	event: MemoryEvent | null;
	memory: MemoryRecord | null;
}

/** The server's message, for showing when a change was refused (e.g. already undone). */
export class MemoryApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers: init?.body ? { "Content-Type": "application/json" } : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new MemoryApiError(data.error ?? "", res.status);
	return data as T;
}

const post = (path: string, body?: object) =>
	call<ChangeResult>(path, {
		method: "POST",
		body: body ? JSON.stringify(body) : undefined,
	});

const patch = (path: string, body: object) =>
	call<ChangeResult>(path, { method: "PATCH", body: JSON.stringify(body) });

const scoped = (scope: string) => `scope=${encodeURIComponent(scope)}`;

export const memoryApi = {
	list: (owner?: string) =>
		call<{ memories: MemoryRecord[] }>(
			`/memories?view=library&include_trashed=1${owner ? `&${scoped(owner)}` : ""}`,
		).then((r) => r.memories),
	create: (scope: string, fields: MemoryFields) =>
		post(`/memories?${scoped(scope)}`, fields),
	revise: (id: string, revision: number, fields: Partial<MemoryFields>) =>
		call<ChangeResult>(`/memories/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify({ ...fields, revision }),
		}),
	trash: (id: string) => post(`/memories/${encodeURIComponent(id)}/trash`),
	restore: (id: string) => post(`/memories/${encodeURIComponent(id)}/restore`),
	/** Deleted for good: the content is erased from the history too. */
	purge: (id: string) => post(`/memories/${encodeURIComponent(id)}/purge`),
	setAlwaysOn: (id: string, always_on: boolean) =>
		patch(`/memories/${encodeURIComponent(id)}`, { always_on }),
	timeline: (id: string) =>
		call<{ timeline: TimelineFact[] }>(
			`/memories/${encodeURIComponent(id)}/timeline`,
		).then((r) => r.timeline),
	history: (id: string) =>
		call<{ events: MemoryEvent[] }>(
			`/memories/${encodeURIComponent(id)}/events`,
		).then((r) => r.events),
	/** Newest first; pass the last id seen as `before` for the next page. */
	events: (
		opts: {
			scope?: string;
			threadId?: string;
			before?: number;
			limit?: number;
		} = {},
	) => {
		const q = new URLSearchParams();
		if (opts.scope) q.set("scope", opts.scope);
		if (opts.threadId) q.set("thread_id", opts.threadId);
		if (opts.before) q.set("before", String(opts.before));
		q.set("limit", String(opts.limit ?? 100));
		return call<{ events: MemoryEvent[] }>(`/memory-events?${q}`).then(
			(r) => r.events,
		);
	},
	revert: (eventId: number) => post(`/memory-events/${eventId}/revert`),
	/** Pasted text read into candidates; nothing is written. */
	importPreview: (scope: string, text: string) =>
		call<{ candidates: ImportCandidate[]; degraded: boolean }>(
			`/import/preview?${scoped(scope)}`,
			{ method: "POST", body: JSON.stringify({ text }) },
		),
	/** The kept candidates, written as one batch: reverting any of its events undoes them all. */
	importCommit: (scope: string, items: ImportCandidate[]) =>
		call<{ events: MemoryEvent[] }>(`/import?${scoped(scope)}`, {
			method: "POST",
			body: JSON.stringify({
				items: items.map((c) => ({
					...c,
					replaces: c.relation === "replaces" ? c.existing?.id : null,
				})),
			}),
		}).then((r) => r.events),
	overview: (scope: string) => call<Overview>(`/overview?${scoped(scope)}`),
	saveScenes: (scenes: { id?: string; name: string; definition: string }[]) =>
		post("/scenes", { scenes }),
	suggestSituations: (
		description: string,
		current: { name: string; definition: string }[],
	) =>
		call<{ situations: SuggestedSituation[] }>("/scenes/suggest", {
			method: "POST",
			body: JSON.stringify({ description, current }),
		}).then((r) => r.situations),
	decideScene: (id: string, accept: boolean) =>
		post(`/scenes/${id}/${accept ? "accept" : "dismiss"}`),
	createProject: (
		name: string,
		paths: string[] = [],
		instructions = "",
		isolated = true,
	) =>
		call<Project>("/projects", {
			method: "POST",
			body: JSON.stringify({ name, paths, instructions, isolated }),
		}),
	setIsolated: (id: string, isolated: boolean) =>
		patch(`/projects/${id}`, { isolated }),
	answerQuestion: (id: string, answer: string) =>
		post(`/questions/${id}`, { answer }),
	renameConcept: (id: string, name: string) =>
		patch(`/concepts/${id}`, { name }),
	mergeConcepts: (keep: string, drop: string) =>
		post("/concepts/merge", { keep, drop }),
	splitConcept: (id: string, name: string, memory_ids: string[]) =>
		post(`/concepts/${id}/split`, { name, memory_ids }),
};
