import { PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import Markdown from "react-markdown";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { memoryApi } from "@/lib/memory-api";
import { saveSettings } from "@/lib/projects/settings";
import type { WorkspaceProject } from "@/lib/projects/types";

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

export function ProjectDetails({
	project,
	onChanged,
}: {
	project: WorkspaceProject;
	onChanged: () => void;
}) {
	const t = useTranslations();
	const [description, setDescription] = useState(project.description);
	const [open, setOpen] = useState(false);
	const [session, setSession] = useState(0);
	const [isolated, setIsolated] = useState(project.isolated);
	const [isolating, setIsolating] = useState(false);
	const [failed, setFailed] = useState(false);
	const hasNotes = description.trim() !== "";

	function edit() {
		setSession((n) => n + 1);
		setOpen(true);
	}

	async function toggleIsolated(checked: boolean) {
		setIsolated(checked);
		setIsolating(true);
		setFailed(false);
		try {
			await memoryApi.setIsolated(project.id, checked);
			onChanged();
		} catch {
			setIsolated(!checked);
			setFailed(true);
		} finally {
			setIsolating(false);
		}
	}

	return (
		<div className="grid max-w-[720px] gap-3">
			<section
				aria-labelledby="pr-notes-title"
				className="min-w-0 rounded-[18px] bg-panel"
			>
				<header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 pt-3.5 pr-3.5 pl-5">
					<div>
						<h2 id="pr-notes-title" className="text-sm font-medium">
							{t("projects.details")}
						</h2>
						<p className="mt-0.5 text-[13px] text-muted-foreground">
							{t("projects.detailsHint")}
						</p>
					</div>
					{hasNotes && (
						<Button variant="secondary" onClick={edit}>
							<PenLine />
							{t("projects.edit")}
						</Button>
					)}
				</header>
				<div className="grid min-h-[200px] px-5 pt-3 pb-5">
					{hasNotes ? (
						<Notes text={description} />
					) : (
						<button
							type="button"
							onClick={edit}
							className="flex flex-col items-center justify-center gap-2 rounded-[12px] text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4"
						>
							<PenLine aria-hidden />
							{t("projects.noNotes")}
						</button>
					)}
				</div>
			</section>

			<section className="flex items-center gap-5 rounded-[18px] bg-panel px-5 py-3.5">
				<div className="min-w-0 flex-1">
					<h2 id="pr-isolated" className="text-sm font-medium">
						{t("projects.isolatedTitle")}
					</h2>
					<p className="mt-0.5 text-[13px] text-muted-foreground">
						{t("projects.isolatedHint")}
					</p>
				</div>
				<Switch
					aria-labelledby="pr-isolated"
					checked={isolated}
					disabled={isolating}
					onCheckedChange={toggleIsolated}
				/>
			</section>
			{failed && (
				<p role="alert" className="text-[13px] text-destructive">
					{t("projects.failed")}
				</p>
			)}

			<NotesEditor
				key={session}
				open={open}
				initial={description}
				onOpenChange={setOpen}
				onSave={async (next) => {
					await saveSettings(project.id, { description: next });
					setDescription(next);
					onChanged();
				}}
			/>
		</div>
	);
}

function NotesEditor({
	open,
	initial,
	onOpenChange,
	onSave,
}: {
	open: boolean;
	initial: string;
	onOpenChange: (open: boolean) => void;
	onSave: (text: string) => Promise<void>;
}) {
	const t = useTranslations();
	const [draft, setDraft] = useState(initial);
	const [mode, setMode] = useState<"edit" | "preview">("edit");
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const dirty = draft !== initial;

	async function save() {
		if (busy || !dirty) return;
		setBusy(true);
		setFailed(false);
		try {
			await onSave(draft);
			onOpenChange(false);
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{t("projects.editNotes")}</DialogTitle>
					<DialogDescription>{t("projects.detailsHint")}</DialogDescription>
				</DialogHeader>
				<form
					className="grid min-w-0 gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
					onKeyDown={(e) => {
						if ((e.metaKey || e.ctrlKey) && e.key === "s") {
							e.preventDefault();
							void save();
						}
					}}
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<ToggleGroup
							variant="segment"
							spacing={0.5}
							value={[mode]}
							onValueChange={(v) => v[0] && setMode(v[0] as typeof mode)}
						>
							<ToggleGroupItem value="edit">
								{t("projects.edit")}
							</ToggleGroupItem>
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
						<div className="h-[min(52dvh,460px)] overflow-auto rounded-[12px] bg-muted px-3.5 py-3">
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
							autoFocus
							aria-label={t("projects.details")}
							placeholder={t("projects.notesPlaceholder")}
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							className="h-[min(52dvh,460px)] resize-none [field-sizing:fixed] px-3.5 py-3 text-sm leading-[1.7]"
						/>
					)}
					{failed && (
						<p role="alert" className="text-[13px] text-destructive">
							{t("projects.failed")}
						</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							{t("projectFiles.cancel")}
						</Button>
						<Button type="submit" disabled={busy || !dirty}>
							{t("projects.save")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
