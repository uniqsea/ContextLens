"use client";
import { Folder, FolderPlus, Pencil, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { InlineConfirm } from "@/components/inline-confirm";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@/components/ui/item";
import { memoryApi } from "@/lib/memory-api";
import { folderApi } from "@/lib/projects/folders";
import {
	removeLocalProject,
	updateLocalProject,
} from "@/lib/projects/settings";
import type { WorkspaceProject } from "@/lib/projects/types";

type Props = {
	project?: WorkspaceProject;
	onSaved: (id: string) => void;
	onRemoved?: () => void;
};

const basename = (path: string) =>
	path.split("/").filter(Boolean).at(-1) ?? path;

export function ProjectForm({ project, onSaved, onRemoved }: Props) {
	const t = useTranslations();
	const nameId = useId();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [paths, setPaths] = useState<string[]>([]);
	const [original, setOriginal] = useState({ name: "", paths: [] as string[] });
	const [busy, setBusy] = useState(false);
	const [ready, setReady] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState("");
	const title = project ? t("projectFiles.edit") : t("lens.newProject");
	const dropped = original.paths.filter((p) => !paths.includes(p)).length;

	async function toggle(next: boolean) {
		if (busy) return;
		setOpen(next);
		if (!next) return;
		setName(project?.name ?? "");
		setPaths([]);
		setOriginal({ name: "", paths: [] });
		setConfirming(false);
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
		if (!project) return;
		setBusy(true);
		try {
			await removeLocalProject(project.id);
			setOpen(false);
			onRemoved?.();
		} catch {
			setError(t("projects.failed"));
			setConfirming(false);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={toggle}>
			<DialogTrigger
				render={<Button variant={project ? "outline" : "default"} />}
			>
				{project ? <Pencil /> : <Plus />}
				{title}
			</DialogTrigger>
			<DialogContent
				className="overflow-y-auto sm:max-w-[560px]"
				aria-describedby={undefined}
			>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<form
					className="grid min-w-0 gap-5"
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<div className="grid gap-1.5">
						<label
							htmlFor={nameId}
							className="text-[12.5px] font-medium text-muted-foreground"
						>
							{t("projects.name")}
						</label>
						<Input
							id={nameId}
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
					</div>

					<FieldSet disabled={busy || !ready} className="min-w-0 gap-1.5">
						<FieldLegend variant="label">
							{t("projectFiles.sources")}
						</FieldLegend>
						<ItemGroup variant="panel">
							{paths.map((path) => (
								<Item
									key={path}
									role="listitem"
									variant="menu"
									size="sm"
									className="flex-nowrap"
								>
									<ItemMedia variant="icon" className="text-muted-foreground">
										<Folder />
									</ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle>{basename(path)}</ItemTitle>
										<ItemDescription className="truncate text-xs" title={path}>
											{path}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											className="rounded-full text-muted-foreground"
											aria-label={t("projectFiles.remove", { path })}
											title={t("projectFiles.disconnect")}
											onClick={() =>
												setPaths((v) => v.filter((p) => p !== path))
											}
										>
											<X />
										</Button>
									</ItemActions>
								</Item>
							))}
							<Item
								role="listitem"
								variant="menu"
								size="sm"
								render={<button type="button" />}
								onClick={pick}
								className="text-muted-foreground hover:text-foreground"
							>
								<ItemMedia variant="icon">
									<FolderPlus />
								</ItemMedia>
								<ItemContent>
									<ItemTitle>{t("projectFiles.add")}</ItemTitle>
								</ItemContent>
							</Item>
						</ItemGroup>
						{dropped > 0 && (
							<p className="px-1 text-xs text-muted-foreground">
								{t("projectFiles.pendingDisconnect", { count: dropped })}
							</p>
						)}
					</FieldSet>

					{error && (
						<p role="alert" className="text-[13px] text-destructive">
							{error}
						</p>
					)}

					{confirming ? (
						<InlineConfirm
							cancelLabel={t("projectFiles.cancel")}
							confirmLabel={t("projectFiles.removeProject")}
							busy={busy}
							onCancel={() => setConfirming(false)}
							onConfirm={remove}
						>
							{t("projectFiles.confirmRemove", { name: project?.name ?? "" })}
						</InlineConfirm>
					) : (
						<DialogFooter className="items-center">
							{project && (
								<Button
									type="button"
									variant="danger"
									className="sm:mr-auto"
									disabled={busy}
									onClick={() => setConfirming(true)}
								>
									{t("projectFiles.removeProject")}
								</Button>
							)}
							<Button
								type="button"
								variant="outline"
								disabled={busy}
								onClick={() => toggle(false)}
							>
								{t("projectFiles.cancel")}
							</Button>
							<Button type="submit" disabled={busy || !ready || !name.trim()}>
								{project ? t("projects.save") : t("lens.newProject")}
							</Button>
						</DialogFooter>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}
