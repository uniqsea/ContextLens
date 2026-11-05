import "server-only";
import { notFound } from "next/navigation";
import { type Conversation, ORDINARY, type WorkspaceProject } from "./types";

async function read<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${process.env.LANGGRAPH_API_URL}/${path}`, {
		...init,
		cache: "no-store",
	});
	if (!res.ok) throw new Error("Workspace could not be loaded");
	return res.json();
}

export const listProjects = () =>
	read<Omit<WorkspaceProject, "latest">[]>("lens/projects");

export async function projectName(scope: string) {
	if (scope === ORDINARY) return null;
	const project = (await listProjects()).find((p) => p.id === scope);
	if (!project) notFound();
	return project.name;
}

interface ThreadSummary {
	thread_id: string;
	updated_at: string;
	extracted: {
		project?: string;
		scope?: string;
		title?: string;
		preview?: string;
	};
}

async function threads(filter: {
	ids?: string[];
	offset?: number;
	limit: number;
}) {
	return read<ThreadSummary[]>("threads/search", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			...filter,
			select: ["thread_id", "updated_at"],
			extract: {
				scope: "metadata.project_scope",
				project: "values.project_id",
				title: "values.messages[0].content",
				preview: "values.messages[-1].content",
			},
		}),
	});
}

// New threads have a scope before the first turn. Older threads carry it in graph state.
function owner({ extracted }: ThreadSummary) {
	return extracted.scope ?? extracted.project ?? ORDINARY;
}

export async function checkThread(scope: string, id: string) {
	if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) notFound();
	const [thread] = await threads({ ids: [id], limit: 1 });
	if (!thread || thread.thread_id !== id || owner(thread) !== scope) notFound();
}

export async function conversationIndex(): Promise<Conversation[]> {
	const conversations: Conversation[] = [];
	const limit = 100;
	for (let offset = 0; ; offset += limit) {
		const page = await threads({ limit, offset });
		for (const thread of page) {
			const { title, preview } = thread.extracted;
			conversations.push({
				id: thread.thread_id,
				scope: owner(thread),
				updated_at: thread.updated_at,
				title: typeof title === "string" ? title.slice(0, 100) : "",
				preview:
					typeof preview === "string"
						? preview.replace(/\s*\[\[[^\]]*\]\]/g, "").slice(0, 200)
						: "",
			});
		}
		if (page.length < limit)
			return conversations.sort((a, b) =>
				b.updated_at.localeCompare(a.updated_at),
			);
	}
}
