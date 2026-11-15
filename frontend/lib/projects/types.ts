import type { Project } from "@/lib/memory-types";

export const ORDINARY = "ordinary";

/** What a request was made of: per kind, its estimated tokens and how many items. */
export type Mix = Partial<
	Record<
		"system" | "memory" | "retrieval" | "short_term" | "user",
		[tokens: number, count: number]
	>
>;

export interface Conversation {
	archived: boolean;
	id: string;
	scope: string;
	title: string;
	preview: string;
	/** Its last answered request; null until a turn is answered. */
	mix: Mix | null;
	updated_at: string;
}

export interface WorkspaceProject extends Project {
	latest: string;
	description: string;
	instructions: string;
	starred: boolean;
	/** The last requests of its conversations, added up; null while none is answered. */
	mix: Mix | null;
	/** How many conversations it holds, archived ones aside. */
	chats: number;
	updated_at: string | null;
}

export interface Directory {
	projects: WorkspaceProject[];
	/** How many conversations sit outside any project, archived ones aside. */
	unfiled: number;
	conversations: Conversation[];
}

export const projectPath = (scope: string) =>
	`/projects/${encodeURIComponent(scope)}`;
