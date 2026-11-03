"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { memoryApi } from "@/lib/memory-api";
import type { Overview } from "@/lib/memory-types";

/** What is waiting on the user: new scenes to agree to, and what upkeep could not settle. */
export function Inbox({
	overview,
	onChanged,
}: {
	overview: Overview;
	onChanged: () => void;
}) {
	const t = useTranslations("lens");
	const [answers, setAnswers] = useState<Record<string, string>>({});
	if (!overview.proposed_scenes.length && !overview.questions.length)
		return null;
	return (
		<section className="lens-await">
			<h3>{t("inbox")}</h3>
			{overview.proposed_scenes.map((s) => (
				<div key={s.id} className="lens-await-item">
					<span>
						{t("proposeScene", { name: s.name })} {s.definition}
					</span>
					<button
						type="button"
						className="lens-act"
						onClick={() => memoryApi.decideScene(s.id, true).then(onChanged)}
					>
						{t("agree")}
					</button>
					<button
						type="button"
						className="lens-act"
						onClick={() => memoryApi.decideScene(s.id, false).then(onChanged)}
					>
						{t("noNeed")}
					</button>
				</div>
			))}
			{overview.questions.map((q) => (
				<form
					key={q.id}
					onSubmit={(e) => {
						e.preventDefault();
						memoryApi.answerQuestion(q.id, answers[q.id] ?? "").then(onChanged);
					}}
				>
					<span>{q.text}</span>
					<input
						type="text"
						aria-label={q.text}
						placeholder={t("yourAnswer")}
						value={answers[q.id] ?? ""}
						onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
					/>
					<button type="submit" className="lens-act">
						{t("answer")}
					</button>
				</form>
			))}
		</section>
	);
}
