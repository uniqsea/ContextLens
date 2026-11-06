import { useId } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ProjectInstructions({
	legacyNotes,
	draft,
	onChange,
}: {
	legacyNotes?: string;
	draft: string;
	onChange: (value: string) => void;
}) {
	const t = useTranslations();
	const id = useId();
	return (
		<section className="grid gap-2">
			<label
				htmlFor={id}
				className="text-[12.5px] font-medium text-muted-foreground"
			>
				{t("projects.instructions")}
			</label>
			<p className="text-xs text-muted-foreground">
				{t("projects.instructionsHint")}
			</p>
			{legacyNotes && (
				<details className="rounded-md bg-muted p-2 text-sm">
					<summary>{t("projects.legacyNotes")}</summary>
					<p className="whitespace-pre-wrap">{legacyNotes}</p>
					{!draft.trim() && (
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => onChange(legacyNotes)}
						>
							{t("projects.copyNotes")}
						</Button>
					)}
				</details>
			)}

			<Textarea
				id={id}
				placeholder={t("projects.instructionsPlaceholder")}
				value={draft}
				onChange={(e) => onChange(e.target.value)}
				className="h-32 resize-none [field-sizing:fixed] px-3.5 py-3 text-sm leading-[1.7]"
			/>
		</section>
	);
}
