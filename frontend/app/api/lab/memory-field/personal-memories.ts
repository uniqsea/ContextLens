import { createHash } from "node:crypto";
import path from "node:path";

type Note = { source: string; text: string };
type Reading = {
	name: string;
	description: string;
	facets: { name: string; refs: string[] }[];
};
type Concept = {
	name: string;
	description: string;
	kind: "reading" | "archive";
	facets: { name: string; records: number[] }[];
};

function metadata(text: string, key: string) {
	const value = text.match(new RegExp("^" + key + ": (.+)$", "m"))?.[1] ?? "";
	if (value.startsWith('"')) {
		try {
			return String(JSON.parse(value));
		} catch {
			return value.slice(1, -1);
		}
	}
	return value;
}

export function personalField(notes: Note[], readings: Reading[]) {
	const records: { text: string; source: string }[] = [];
	const refs = new Map<string, number>();
	const groups = new Map<string, Concept>();
	const indexes = new Map(
		notes
			.filter((n) => path.basename(n.source) === "index.md")
			.map((n) => [path.dirname(n.source), n]),
	);
	for (const note of notes) {
		const owner = indexes.get(path.dirname(note.source)) ?? note;
		let concept = groups.get(owner.source);
		if (!concept) {
			concept = {
				name: metadata(owner.text, "name"),
				description: metadata(owner.text, "description"),
				kind: "archive",
				facets: [],
			};
			groups.set(owner.source, concept);
		}
		let section = "";
		for (const line of note.text.split(/\r?\n/)) {
			if (/^#+\s/.test(line)) section = line.replace(/^#+\s+/, "");
			const text = /^\s*[-*+]\s+(.+)/.exec(line)?.[1].trim();
			if (!text) continue;
			const id = records.length;
			records.push({
				text,
				source: [note.source, section].filter(Boolean).join(" › "),
			});
			refs.set(
				createHash("sha256")
					.update(note.source + "\n" + text)
					.digest("hex"),
				id,
			);
			const name =
				section || (owner === note ? "记忆线索" : metadata(note.text, "name"));
			let facet = concept.facets.find((f) => f.name === name);
			if (!facet) {
				facet = { name, records: [] };
				concept.facets.push(facet);
			}
			facet.records.push(id);
		}
	}
	const concepts: Concept[] = [];
	for (const r of readings) {
		const facets = r.facets.map((f) => ({
			name: f.name,
			records: f.refs.flatMap((ref) => (refs.has(ref) ? [refs.get(ref)!] : [])),
		}));
		// A changed archive requires review before showing its former interpretation.
		if (
			facets.length &&
			facets.every(
				(f, i) =>
					f.records.length && f.records.length === r.facets[i].refs.length,
			)
		)
			concepts.push({
				name: r.name,
				description: r.description,
				kind: "reading",
				facets,
			});
	}
	return {
		records,
		concepts: [
			...concepts,
			...[...groups.values()].filter((c) => c.facets.length),
		],
	};
}
