import Markdown from "react-markdown";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
const prose = [
	"min-w-0 text-[15px] leading-[1.75] [overflow-wrap:anywhere]",
	"[&>*+*]:mt-3",
	"[&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:leading-snug",
	"[&_h1]:text-[1.55em] [&_h2]:text-[1.3em] [&_h3]:text-[1.12em]",
	"[&_ul]:list-disc [&_ol]:list-decimal [&_:is(ul,ol)]:ps-6",
	"[&_a]:text-mem [&_a]:underline",
	"[&_blockquote]:border-s-[3px] [&_blockquote]:border-border [&_blockquote]:ps-4 [&_blockquote]:text-muted-foreground",
	"[&_code]:rounded-[5px] [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[.9em]",
	"[&_pre]:overflow-auto [&_pre]:rounded-[12px] [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
].join(" ");

function Notes({ text }: { text: string }) {
	return (
		<div className={prose}>
			<Markdown skipHtml components={{ img: ({ alt }) => <>{alt}</> }}>
				{text}
			</Markdown>
		</div>
	);
}

export function ProjectInstructions({
	legacyNotes,
	draft,
	onChange,
}: {
	legacyNotes: string;
	draft: string;
	onChange: (value: string) => void;
}) {
	const t = useTranslations();
	const [mode, setMode] = useState<"edit" | "preview">("edit");
	return (
		<section className="grid gap-2">
			<h3 className="text-sm font-medium">{t("projects.instructions")}</h3>
			<p className="text-xs text-muted-foreground">
				{t("projects.instructionsHint")}
			</p>
			{legacyNotes && (
				<details className="rounded-md bg-muted p-2 text-sm">
					<summary>{t("projects.legacyNotes")}</summary>
					<Notes text={legacyNotes} />
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

			<div className="flex flex-wrap items-center justify-between gap-2">
				<ToggleGroup
					variant="segment"
					spacing={0.5}
					value={[mode]}
					onValueChange={(v) => v[0] && setMode(v[0] as typeof mode)}
				>
					<ToggleGroupItem value="edit">{t("projects.edit")}</ToggleGroupItem>
					<ToggleGroupItem value="preview">
						{t("projects.preview")}
					</ToggleGroupItem>
				</ToggleGroup>
				<span className="text-xs text-muted-foreground tabular-nums">
					{t("projects.markdownSupported")} ·{" "}
					{t("projects.chars", { count: draft.length })}
				</span>
			</div>
			{mode === "preview" ? (
				<div className="h-32 overflow-auto rounded-[12px] bg-muted px-3.5 py-3">
					{draft.trim() ? (
						<Notes text={draft} />
					) : (
						<p className="text-[13px] text-muted-foreground">
							{t("projects.nothingToPreview")}
						</p>
					)}
				</div>
			) : (
				<Textarea
					aria-label={t("projects.instructions")}
					placeholder={t("projects.instructionsPlaceholder")}
					value={draft}
					onChange={(e) => onChange(e.target.value)}
					className="h-32 resize-none [field-sizing:fixed] px-3.5 py-3 text-sm leading-[1.7]"
				/>
			)}
		</section>
	);
}
