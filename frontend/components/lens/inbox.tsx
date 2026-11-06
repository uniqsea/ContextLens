"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
					<Button
						type="button"
						variant="secondary"
						size="chip"
						onClick={() => memoryApi.decideScene(s.id, true).then(onChanged)}
					>
						{t("agree")}
					</Button>
					<Button
						type="button"
						variant="secondary"
						size="chip"
						onClick={() => memoryApi.decideScene(s.id, false).then(onChanged)}
					>
						{t("noNeed")}
					</Button>
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
					<Input
						className="h-8 min-w-30 flex-1"
						type="text"
						aria-label={q.text}
						placeholder={t("yourAnswer")}
						value={answers[q.id] ?? ""}
						onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
					/>
					<Button type="submit" variant="secondary" size="chip">
						{t("answer")}
					</Button>
				</form>
			))}
		</section>
	);
}
