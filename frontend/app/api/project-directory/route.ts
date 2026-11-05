import { conversationIndex, listProjects } from "@/lib/projects/server";

export async function GET(request: Request) {
	const scope = new URL(request.url).searchParams.get("scope");
	const [projects, threads] = await Promise.all([
		listProjects(),
		conversationIndex(),
	]);
	const recent = new Map<string, (typeof threads)[number]>();
	for (const thread of threads) {
		if (!recent.has(thread.scope)) recent.set(thread.scope, thread);
	}
	return Response.json({
		projects: projects.map((project) => {
			const latest = recent.get(project.id);
			return {
				...project,
				latest: latest?.title ?? "",
				updated_at: [project.updated_at, latest?.updated_at]
					.filter(Boolean)
					.sort()
					.at(-1),
			};
		}),
		conversations: threads.filter((thread) => thread.scope === scope),
	});
}
