import type { Project } from "@/lib/memory-types";

export const ORDINARY = "ordinary";

export interface Conversation {
	archived: boolean;
	id: string;
	scope: string;
	title: string;
	preview: string;
	updated_at: string;
}

export interface WorkspaceProject extends Project {
	latest: string;
	description: string;
	instructions: string;
	starred: boolean;
	updated_at: string | null;
}

export interface Directory {
	projects: WorkspaceProject[];
	conversations: Conversation[];
}

export const projectPath = (scope: string) =>
	`/projects/${encodeURIComponent(scope)}`;
