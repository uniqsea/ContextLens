import type { MemoryChange } from "@/lib/memory-types";

export type Layer = "system" | "memory" | "retrieval" | "user" | "short_term";
export type CandidateStatus =
	| "active"
	| "temporarily_ignored"
	| "context_blocked"
	| "trashed";

/** Why an item was or was not selected; the client words it (see context_control.reason). */
export interface Reason {
	code: string;
}

/** One edit behind a rewritten answer, stored with the version and worded when shown. */
export interface Change {
	op:
		| "exclude"
		| "remove"
		| "unlink"
		| "restore"
		| "pin"
		| "reading"
		| "brighten"
		| "dim";
	id: string;
	/** For concepts, which are not among the candidates. */
	name?: string;
}

/** How a turn read the moment: which scenes, what was being done, which things were named. */
export interface Situation {
	scenes: string[];
	doing: string;
	concepts: string[];
	degraded?: boolean;
}

/** One context item as the agent saw it for a request (see context_control.prepare_snapshot). */
export interface Candidate {
	id: string;
	layer: Layer;
	title: string;
	content: string;
	status: CandidateStatus;
	selection_reason: Reason;
	source_label?: string | null;
	scenes?: string[] | null;
	memory_type?: string | null;
	stale?: boolean | null;
	tokens: number;
	revision?: number | null;
}

export interface Snapshot {
	candidates: Candidate[];
	selected_ids: string[];
	messages: Array<{ role: string; content: string }>;
	fingerprint: string;
}

export interface Segment {
	text: string;
	src: string[];
}

export interface AnswerVersion {
	note: Change[];
	content: string;
	segments: Segment[];
	selected_ids: string[];
	candidates: Candidate[];
	payload: Array<{ role: string; content: string }>;
	excluded: string[];
	pinned: string[];
	created_at: string;
	situation: Situation;
	/** The concepts in play, as far as memory knows them. */
	concepts: Array<{ id: string; name: string }>;
	brighten: string[];
	dim: string[];
}

export interface TurnRecord {
	index: number;
	query: string;
	versions: AnswerVersion[];
	/** Memory changes this turn made: the agent's own during the task, then the upkeep's after it. */
	memory_changes?: MemoryChange[];
}

export interface LensState extends Record<string, unknown> {
	messages: Array<{ id?: string; type: string; content: unknown }>;
	turn_records?: Record<string, TurnRecord>;
	history_lineage?: Record<string, unknown>;
	project_id?: string | null;
}

/**
 * Where a card sits in the field for the request being looked at.
 * in: sent. near: relevant but crowded out. ex: set aside by you. idle: on the shelf, out of sight.
 */
export type CardState = "in" | "near" | "ex" | "idle";

export const FIELD_LAYERS: Layer[] = ["memory", "retrieval", "short_term"];

export function cardState(c: Candidate, selected: string[]): CardState {
	if (selected.includes(c.id)) return "in";
	if (c.status === "temporarily_ignored") return "ex";
	if (c.selection_reason?.code === "near_miss") return "near";
	return "idle";
}

export function layerColor(layer: Layer): string {
	if (layer === "retrieval") return "var(--l-kind-doc)";
	if (layer === "short_term") return "var(--l-kind-hist)";
	if (layer === "system") return "var(--l-kind-sys)";
	if (layer === "user") return "var(--l-kind-user)";
	return "var(--l-kind-mem)";
}

/** Drop the attribution markers a streaming answer still carries. */
export function stripMarkers(text: string): string {
	return text.replace(/\s*\[\[[^\]]*\]\]/g, "").replace(/\s*\[\[[^\]]*$/, "");
}
