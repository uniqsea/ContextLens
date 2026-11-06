export type MemoryType = "semantic" | "episodic" | "procedural";
export type MemoryConfidence = "high" | "low";
export type MemoryLifecycleState = "active" | "trashed";
export interface MemoryRecord {
	scope: string;
	revision: number;
	id: string;
	title: string;
	content: string;
	memory_type: MemoryType;
	confidence: MemoryConfidence;
	scenes: string[];
	concepts: Array<{ id: string; name: string }>;
	created_at: string;
	updated_at: string;
	source_kind: string;
	lifecycle_state: MemoryLifecycleState;
	deleted_at: string | null;
	always_on: boolean;
	check_at: string | null;
	/** Its check date has passed: it may be out of date. */
	due: boolean;
}

/** Who changed a memory: you, the agent during a task, the upkeep after a turn, or the import of
 * memories recorded before the change log existed. */
export type MemoryActor = "user" | "agent" | "consolidation" | "import";
export type MemoryEventKind =
	| "created"
	| "revised"
	| "trashed"
	| "restored"
	| "purged";

/** The memory's fields at one point; title and content are null once it is deleted for good. */
export interface MemorySnapshot {
	title: string | null;
	content: string | null;
	memory_type: MemoryType;
	confidence: MemoryConfidence;
	scenes: string[];
	lifecycle_state: MemoryLifecycleState;
	revision?: number;
}

export interface MemoryEvent {
	id: number;
	memory_id: string;
	kind: MemoryEventKind;
	revision: number | null;
	before: MemorySnapshot | null;
	after: MemorySnapshot | null;
	actor: MemoryActor;
	thread_id: string | null;
	turn: number | null;
	reason: string | null;
	/** What you said that led to the change. */
	evidence: string | null;
	reverts: number | null;
	reverted_by: number | null;
	created_at: string;
}

/** One memory change as listed under the answer that caused it. */
export interface MemoryChange {
	event_id: number;
	memory_id: string;
	kind: MemoryEventKind;
	actor: MemoryActor;
	title: string | null;
	content: string | null;
	previous: string | null;
	reason: string | null;
}

/** A fact on a memory's timeline: what was true, and what replaced it. */
export interface TimelineFact {
	id: string;
	content: string;
	created_at: string;
	current: boolean;
}

export interface Concept {
	id: string;
	name: string;
	aliases: string[];
	count: number;
}

export interface Scene {
	id: string;
	name: string;
	definition: string;
	reason: string | null;
}

export interface Project {
	id: string;
	name: string;
	isolated: boolean;
}

export interface Question {
	id: string;
	text: string;
}

/** What surrounds the memories of a scope: where to look from, and what waits on the user. */
export interface Overview {
	projects: Project[];
	scenes: Scene[];
	proposed_scenes: Scene[];
	concepts: Concept[];
	questions: Question[];
}

/** A situation the AI suggests from how the user describes their use; nothing is saved yet. */
export interface SuggestedSituation {
	name: string;
	definition: string;
	reason: string;
}

/** A memory read from pasted text, not yet written; `existing` is what it repeats, updates or contradicts. */
export interface ImportCandidate {
	key: number;
	learned: string;
	evidence: string;
	source: "said" | "inferred";
	concepts: string[];
	scenes: string[];
	/** When it was true or learned, if before today; empty means the day it is imported. */
	noted: string | null;
	check_at: string | null;
	relation: "new" | "same" | "replaces" | "conflicts";
	existing: { id: string; learned: string } | null;
}
