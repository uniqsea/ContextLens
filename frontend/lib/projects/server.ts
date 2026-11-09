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

export async function checkThread(scope: string, id: string) {
	if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) notFound();
	const res = await fetch(
		`${process.env.LANGGRAPH_API_URL}/lens/conversations/${id}`,
		{ cache: "no-store" },
	);
	if (res.status === 404) notFound();
	if (!res.ok) throw new Error("Workspace could not be loaded");
	const conversation: Conversation = await res.json();
	if (conversation.scope !== scope) notFound();
	return conversation.title;
}

// Newest activity first.
export const conversationIndex = () =>
	read<Conversation[]>("lens/conversations");
