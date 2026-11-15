import { conversationIndex, listProjects } from "@/lib/projects/server";
import { type Mix, ORDINARY } from "@/lib/projects/types";

export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const scope = params.get("scope");
	const [projects, threads] = await Promise.all([
		listProjects(),
		conversationIndex(),
	]);
	const recent = new Map<string, (typeof threads)[number]>();
	// A project's picture is its conversations' last requests added up.
	const mixes = new Map<string, Mix>();
	const chats = new Map<string, number>();
	for (const thread of threads) {
		if (thread.archived) continue;
		if (!recent.has(thread.scope)) recent.set(thread.scope, thread);
		chats.set(thread.scope, (chats.get(thread.scope) ?? 0) + 1);
		if (!thread.mix) continue;
		const sum = mixes.get(thread.scope) ?? {};
		for (const [layer, [tokens, count]] of Object.entries(thread.mix)) {
			const before = sum[layer as keyof Mix] ?? [0, 0];
			sum[layer as keyof Mix] = [before[0] + tokens, before[1] + count];
		}
		mixes.set(thread.scope, sum);
	}
	return Response.json({
		projects: projects.map((project) => {
			const latest = recent.get(project.id);
			return {
				...project,
				latest: latest?.title ?? "",
				mix: mixes.get(project.id) ?? null,
				chats: chats.get(project.id) ?? 0,
				updated_at: [project.updated_at, latest?.updated_at]
					.filter(Boolean)
					.sort()
					.at(-1),
			};
		}),
		unfiled: chats.get(ORDINARY) ?? 0,
		conversations:
			params.get("view") === "search"
				? threads.filter((thread) => !thread.archived)
				: threads.filter((thread) => thread.scope === scope),
	});
}
