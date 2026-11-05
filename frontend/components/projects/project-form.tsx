"use client";
import { Folder, FolderPlus, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { memoryApi } from "@/lib/memory-api";
import { folderApi } from "@/lib/projects/folders";
import {
	removeLocalProject,
	updateLocalProject,
} from "@/lib/projects/settings";
import type { WorkspaceProject } from "@/lib/projects/types";
import { DisconnectFolder } from "./disconnect-folder";

type Props = {
	project?: WorkspaceProject;
	onSaved: (id: string) => void;
	onRemoved?: () => void;
};

export function ProjectForm({ project, onSaved, onRemoved }: Props) {
	const t = useTranslations();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [paths, setPaths] = useState<string[]>([]);
	const [original, setOriginal] = useState({ name: "", paths: [] as string[] });
	const [busy, setBusy] = useState(false);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState("");
	const title = project ? t("projectFiles.edit") : t("lens.newProject");
	async function toggle(next: boolean) {
		if (busy) return;
		setOpen(next);
		if (!next) return;
		setName(project?.name ?? "");
		setPaths([]);
		setError("");
		setReady(!project);
		if (!project) return;
		setBusy(true);
		try {
			const saved = (await folderApi.list(project.id)).map((f) => f.path);
			setPaths(saved);
			setOriginal({ name: project.name, paths: saved });
			setReady(true);
		} catch {
			setError(t("projects.failed"));
		} finally {
			setBusy(false);
		}
	}
	async function pick() {
		setBusy(true);
		setError("");
		try {
			const chosen = await folderApi.choosePaths();
			setPaths((prev) => [...new Set([...prev, ...chosen])]);
		} catch {
			setError(t("projectFiles.pickFailed"));
		} finally {
			setBusy(false);
		}
	}
	async function save() {
		if (busy || !ready || !name.trim()) return;
		setBusy(true);
		setError("");
		try {
			const draft = { name: name.trim(), paths };
			if (project) {
				await updateLocalProject(project.id, draft, original);
				onSaved(project.id);
			} else {
				const created = await memoryApi.createProject(draft.name, draft.paths);
				onSaved(created.id);
			}
			setOpen(false);
		} catch {
			setError(t("projectFiles.saveFailed"));
		} finally {
			setBusy(false);
		}
	}
	async function remove() {
		if (
			!project ||
			!window.confirm(t("projectFiles.confirmRemove", { name: project.name }))
		)
			return;
		setBusy(true);
		try {
			await removeLocalProject(project.id);
			setOpen(false);
			onRemoved?.();
		} catch {
			setError(t("projects.failed"));
		} finally {
			setBusy(false);
		}
	}
	return (
		<Dialog open={open} onOpenChange={toggle}>
			<DialogTrigger
				className={project ? "lens-btn outline" : "lens-btn primary"}
			>
				{project ? <Pencil /> : <Plus />}
				{title}
			</DialogTrigger>
			<DialogContent
				className="lens-theme pr-editor"
				overlayClassName="pr-editor-scrim"
				aria-describedby={undefined}
			>
				<DialogTitle className="pr-editor-title">{title}</DialogTitle>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<label className="pr-editor-name">
						<span>
							<Folder />
						</span>
						<input
							aria-label={t("projects.name")}
							placeholder={t("projects.name")}
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
					</label>
					<fieldset disabled={busy || !ready}>
						<legend>{t("projectFiles.sources")}</legend>
						<div className="pr-editor-folders">
							{paths.map((path) => {
								const basename = path.split("/").filter(Boolean).at(-1) ?? path;
								return (
									<div key={path} className="pr-editor-row">
										<Folder />
										<span title={path}>{basename}</span>
										<DisconnectFolder
											path={path}
											disabled={busy}
											onConfirm={() =>
												setPaths((v) => v.filter((p) => p !== path))
											}
										/>
									</div>
								);
							})}
							<button className="pr-editor-add" type="button" onClick={pick}>
								<FolderPlus />
								{t("projectFiles.add")}
							</button>
						</div>
					</fieldset>
					{error && <p role="alert">{error}</p>}
					<footer>
						{project && (
							<button
								className="pr-editor-remove"
								type="button"
								disabled={busy}
								onClick={remove}
							>
								{t("projectFiles.removeProject")}
							</button>
						)}
						<button
							className="pr-editor-cancel"
							type="button"
							disabled={busy}
							onClick={() => toggle(false)}
						>
							{t("projectFiles.cancel")}
						</button>
						<button
							className="pr-editor-save"
							type="submit"
							disabled={busy || !ready || !name.trim()}
						>
							{project ? t("projects.save") : t("lens.newProject")}
						</button>
					</footer>
				</form>
			</DialogContent>
		</Dialog>
	);
}
