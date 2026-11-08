import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { personalField } from "./personal-memories";

type Turn = { speaker: string; dia_id: string; text: string };
type Sample = {
	sample_id: string;
	conversation: Record<string, string | Turn[]>;
	qa: { question: string; evidence?: string[] }[];
};

function locomoField(samples: Sample[]) {
	const records: { title: string; source: string; text: string }[] = [];
	const contexts: {
		title: string;
		source: string;
		links: { record: number; reason: string }[];
	}[] = [];
	for (const sample of samples) {
		const turns = new Map<string, number>();
		for (const [session, messages] of Object.entries(sample.conversation)) {
			if (!Array.isArray(messages) || !/^session_\d+$/.test(session)) continue;
			for (const message of messages) {
				turns.set(message.dia_id, records.length);
				records.push({
					title: message.speaker + " · " + message.dia_id,
					source: [sample.sample_id, session, message.dia_id].join(" / "),
					text: message.text,
				});
			}
		}
		for (const question of sample.qa) {
			const evidence = [...new Set(question.evidence)];
			const links = evidence.flatMap((id) => {
				const record = turns.get(id);
				return record === undefined
					? []
					: [{ record, reason: "LoCoMo 原始证据标注 · " + id }];
			});
			if (links.length && links.length === evidence.length) {
				contexts.push({
					title: question.question,
					source: sample.sample_id,
					links,
				});
			}
		}
	}
	return { records, contexts };
}

export async function loadField(source: "personal" | "locomo") {
	const base = path.resolve(
		/* turbopackIgnore: true */ process.cwd(),
		"../evaluation/dataset",
	);
	if (source === "locomo") {
		const data = await readFile(
			/* turbopackIgnore: true */ path.join(base, "locomo/locomo10.json"),
			"utf8",
		);
		return locomoField(JSON.parse(data));
	}
	const folder = path.join(base, "claude-memory");
	const archive = path.join(folder, "notes");
	const entries = await readdir(/* turbopackIgnore: true */ archive, {
		recursive: true,
		withFileTypes: true,
	});
	const files = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) =>
			path.relative(archive, path.join(entry.parentPath, entry.name)),
		)
		.sort();
	const notes = await Promise.all(
		files.map(async (file) => ({
			source: file.split(path.sep).join("/"),
			text: (
				await readFile(
					/* turbopackIgnore: true */ path.join(archive, file),
					"utf8",
				)
			).replace(/^\uFEFF/, ""),
		})),
	);
	const readings = await readFile(
		/* turbopackIgnore: true */ path.join(folder, "concept-readings.json"),
		"utf8",
	).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return "[]";
		throw error;
	});
	return personalField(notes, JSON.parse(readings));
}
