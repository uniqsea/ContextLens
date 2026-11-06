"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AnswerVersion, Change } from "@/lib/lens/types";
import type { Concept, Scene } from "@/lib/memory-types";
import type { Rewrite } from "./answer-card";
import { MenuSelect } from "./menu-select";

const MOST_SCENES = 2; // the first picked is the main one

const toggled = (list: string[], id: string) =>
	list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

/** How this turn read the moment. A wrong reading can be corrected and concepts brightened or
 * dimmed; the answer is then rewritten the way any other change to its context is. */
export function TurnReading({
	version,
	scenes,
	concepts,
	busy,
	onRewrite,
}: {
	version: AnswerVersion;
	scenes: Scene[];
	concepts: Concept[];
	busy: boolean;
	onRewrite: (change: Rewrite) => void;
}) {
	const t = useTranslations("lens");
	const [editing, setEditing] = useState(false);
	const [doing, setDoing] = useState(version.situation.doing);
	const [picked, setPicked] = useState(version.situation.scenes);
	const [bright, setBright] = useState(version.brighten);
	const [dim, setDim] = useState(version.dim);
	const [notes, setNotes] = useState<Change[]>([]);

	const name = (id: string) => concepts.find((c) => c.id === id)?.name ?? id;
	const shown = [
		...version.concepts.map((c) => c.id),
		...bright.filter((id) => !version.concepts.some((c) => c.id === id)),
		...dim.filter((id) => !version.concepts.some((c) => c.id === id)),
	];
	const corrected =
		doing !== version.situation.doing ||
		picked.join() !== version.situation.scenes.join();
	const dirty = corrected || notes.length > 0;

	const adjust = (op: "brighten" | "dim", id: string) => {
		setNotes([...notes, { op, id, name: name(id) }]);
		if (op === "brighten") {
			setBright(toggled(bright, id));
			setDim(dim.filter((x) => x !== id));
		} else {
			setDim(toggled(dim, id));
			setBright(bright.filter((x) => x !== id));
		}
	};

	return (
		<div className="lens-reading">
			{editing ? (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						setEditing(false);
					}}
				>
					<Input
						className="h-8"
						type="text"
						value={doing}
						aria-label={t("doing")}
						onChange={(e) => setDoing(e.target.value)}
					/>
					<div className="flex flex-wrap gap-1.5">
						{scenes.map((s) => (
							<Button
								key={s.id}
								type="button"
								variant="secondary"
								size="sm"
								title={s.definition}
								aria-pressed={picked.includes(s.name)}
								disabled={
									picked.length >= MOST_SCENES && !picked.includes(s.name)
								}
								onClick={() => setPicked(toggled(picked, s.name))}
							>
								{s.name}
							</Button>
						))}
					</div>
					<Button type="submit" variant="secondary" size="chip">
						{t("confirm")}
					</Button>
				</form>
			) : (
				<div className="lens-reading-line">
					{picked.length > 0 && <em>{picked.join(" · ")}</em>}
					<span>{doing}</span>
					<button
						type="button"
						title={t("correctTitle")}
						onClick={() => setEditing(true)}
					>
						{t("correct")}
					</button>
				</div>
			)}
			{version.situation.degraded && <span>{t("degraded")}</span>}
			<div className="lens-reading-concepts">
				{shown.map((id) => (
					<span
						key={id}
						className="lens-lit"
						data-state={
							dim.includes(id) ? "dim" : bright.includes(id) ? "bright" : "lit"
						}
					>
						{version.concepts.find((c) => c.id === id)?.name ?? name(id)}
						<button
							type="button"
							aria-label={t("brighten", { name: name(id) })}
							aria-pressed={bright.includes(id)}
							onClick={() => adjust("brighten", id)}
						>
							<Sun aria-hidden="true" />
						</button>
						<button
							type="button"
							aria-label={t("dim", { name: name(id) })}
							aria-pressed={dim.includes(id)}
							onClick={() => adjust("dim", id)}
						>
							<Moon aria-hidden="true" />
						</button>
					</span>
				))}
				{concepts.some((c) => !shown.includes(c.id)) && (
					<MenuSelect
						label={t("lightUp")}
						placeholder={t("lightUp")}
						options={concepts
							.filter((c) => !shown.includes(c.id))
							.map((c) => ({ value: c.id, label: c.name }))}
						onChange={(id) => adjust("brighten", id)}
						triggerClassName="lens-reading-add"
						chevron={false}
					/>
				)}
				{dirty && (
					<Button
						type="button"
						variant="secondary"
						size="chip"
						title={t("rewriteHint")}
						disabled={busy}
						onClick={() => {
							onRewrite({
								excluded: version.excluded,
								pinned: version.pinned,
								note: [
									...(corrected
										? [{ op: "reading" as const, id: "reading" }]
										: []),
									...notes,
								],
								...(corrected ? { situation: { doing, scenes: picked } } : {}),
								brighten: bright,
								dim,
							});
							setNotes([]);
						}}
					>
						{t("rewrite")}
					</Button>
				)}
			</div>
		</div>
	);
}
