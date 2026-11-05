import type { WorkspaceProject } from "./types";

export async function saveSettings(
	id: string,
	fields: Partial<Pick<WorkspaceProject, "starred" | "description">>,
) {
	const res = await fetch(
		`/api/lens/projects/${encodeURIComponent(id)}/settings`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(fields),
		},
	);
	if (!res.ok) throw new Error("Project settings could not be saved");
}

type ProjectDraft = { name: string; paths: string[] };

export async function updateLocalProject(
	id: string,
	draft: ProjectDraft,
	previous: ProjectDraft,
) {
	const res = await fetch(`/api/lens/projects/${encodeURIComponent(id)}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...draft, previous }),
	});
	if (!res.ok) throw new Error("Project could not be updated");
}

export async function removeLocalProject(id: string) {
	const res = await fetch(`/api/lens/projects/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
	if (!res.ok) throw new Error("Project could not be removed");
}
