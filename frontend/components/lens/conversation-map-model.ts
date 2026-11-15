import type { AnswerVersion, Layer, TurnRecord } from "@/lib/lens/types";

/**
 * history: an earlier turn, carried into a later one's request.
 * written: a memory one turn wrote and a later one read.
 * again: a source a later turn used once more.
 */
export type LinkKind = "history" | "written" | "again";

/** A step of a turn, by the id its node carries in that turn's flow (see TurnSteps). */
export interface MapEnd {
	turn: number;
	node: string;
}

export interface CrossLink {
	key: string;
	kind: LinkKind;
	layer: Layer;
	from: MapEnd;
	to: MapEnd;
}

const SOURCES: Layer[] = ["memory", "retrieval", "short_term"];

type Artifact = {
	memories?: (string | { id: string })[];
	document?: { id: string };
	documents?: { id: string }[];
	history?: { id: string }[];
	events?: { memory_id?: string; entity_id?: string; entity?: string }[];
};

/** Older checkpoints stored a tool's artifact as a list; those carry nothing to link. */
const artifact = (value: unknown): Artifact =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Artifact)
		: {};

/** Where a turn's answer was written: its last model call, or the one node older turns have. */
function answerNode(version: AnswerVersion) {
	const calls = version.agent_calls ?? [];
	return calls.length ? `call-${calls.length - 1}` : "legacy-answer";
}

/** What ties the turns together, each link from the step that produced something to the step that took it in. */
export function crossLinks(ordered: TurnRecord[]): CrossLink[] {
	const links: CrossLink[] = [];
	// Where each source was last seen or written, to link its next use back to.
	const last = new Map<string, MapEnd & { wrote: boolean }>();
	const answers = new Map<number, string>();

	for (const record of ordered) {
		const version = record.versions[record.versions.length - 1];
		const turn = record.index;
		const byId = new Map(version.candidates.map((c) => [c.id, c]));
		const reads = new Map<string, { node: string; layer: Layer }>();
		for (const id of version.assembled_ids ?? version.selected_ids) {
			const c = byId.get(id);
			if (c && SOURCES.includes(c.layer))
				reads.set(id, { node: `source-${id}`, layer: c.layer });
		}
		const writes = new Map<string, string>();
		for (const step of version.steps ?? []) {
			if (!step.call_id) continue;
			const found = artifact(step.artifact);
			const node = `tool-${step.call_id}`;
			const took: Array<[string | undefined, Layer]> = [
				...(found.memories ?? []).map((m): [string, Layer] => [
					typeof m === "string" ? m : m.id,
					"memory",
				]),
				[found.document?.id, "retrieval"],
				...(found.documents ?? []).map((d): [string, Layer] => [
					d.id,
					"retrieval",
				]),
				...(found.history ?? []).map((h): [string, Layer] => [
					h.id,
					"short_term",
				]),
			];
			for (const [id, layer] of took)
				if (id && !reads.has(id)) reads.set(id, { node, layer });
			for (const event of found.events ?? []) {
				const id = event.memory_id ?? event.entity_id;
				if (id && (event.entity ?? "memories") === "memories")
					writes.set(id, node);
			}
		}
		// What the upkeep wrote after the answer hangs off the writing step, or off the answer.
		const changes = record.memory_changes ?? version.written_changes ?? [];
		const aside =
			version.writing_calls || changes.length ? "writing" : answerNode(version);
		for (const change of changes)
			if (!writes.has(change.memory_id)) writes.set(change.memory_id, aside);

		for (const [id, read] of reads) {
			const to = { turn, node: read.node };
			const before = last.get(id);
			// This conversation's own turns are numbered from zero in their ids.
			const earlier = /^st-(\d+)$/.exec(id);
			const answered = earlier && answers.get(Number(earlier[1]));
			// A source is tied to where it was last seen, so every wire runs to a nearby turn; only
			// its first use reaches back to the step that made it.
			if (before)
				links.push({
					key: `${turn}:${id}`,
					kind: before.wrote ? "written" : "again",
					layer: read.layer,
					from: { turn: before.turn, node: before.node },
					to,
				});
			else if (earlier && answered)
				links.push({
					key: `${turn}:${id}`,
					kind: "history",
					layer: "short_term",
					from: { turn: Number(earlier[1]), node: answered },
					to,
				});
			last.set(id, { ...to, wrote: false });
		}
		for (const [id, node] of writes) last.set(id, { turn, node, wrote: true });
		answers.set(turn, answerNode(version));
	}
	return links;
}
