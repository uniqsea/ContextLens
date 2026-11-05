export interface ProjectFolder {
	id: string;
	path: string;
}

export interface FileEntry {
	name: string;
	path: string;
	directory: boolean;
}

async function request<T = ProjectFolder[]>(
	project: string,
	suffix = "",
	init?: RequestInit,
): Promise<T> {
	const result = await fetch(
		`/api/lens/projects/${encodeURIComponent(project)}/folders${suffix}`,
		{
			cache: "no-store",
			...init,
		},
	);
	if (!result.ok) throw new Error("Folder operation failed");
	return result.json();
}

export const folderApi = {
	entries: (
		project: string,
		folder: string,
		directory: string,
		q: string,
		signal: AbortSignal,
	) =>
		request<FileEntry[]>(
			project,
			`/${encodeURIComponent(folder)}/files?${new URLSearchParams({ directory, q })}`,
			{ signal },
		),
	choosePaths: async (): Promise<string[]> => {
		const res = await fetch("/api/lens/folder-picker", { method: "POST" });
		if (!res.ok) throw new Error("Folder picker unavailable");
		return res.json();
	},
	list: (project: string, signal?: AbortSignal) =>
		request(project, "", { signal }),
	remove: (project: string, id: string) =>
		request(project, `/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
