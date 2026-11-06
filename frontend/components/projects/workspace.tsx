"use client";
import { Folder, Folders, LayoutGrid, List, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MemoryLibrary } from "@/components/memory-library";
import { MenuSelect } from "@/components/lens/menu-select";
import { WorkspaceLoading, NotFound } from "@/components/page-status";
import { Button } from "@/components/ui/button";
import { saveSettings } from "@/lib/projects/settings";
import { ORDINARY, projectPath } from "@/lib/projects/types";
import { NewChat } from "./new-chat";
import { ProjectCard } from "./project-card";
import { ProjectFolders } from "./project-folders";
import { ProjectForm } from "./project-form";
import { useWorkspaceDirectory } from "./use-directory";

export function ProjectWorkspace({ scope }: { scope?: string }) {
	const t = useTranslations();
	const router = useRouter();
	const { data, failed, reload } = useWorkspaceDirectory();
	const [starFailed, setStarFailed] = useState(false);
	const [list, setList] = useState(false);
	const params = useSearchParams();
	const requested = scope ? params.get("tab") : null;
	const tab =
		requested === "memories" || (scope !== ORDINARY && requested === "files")
			? requested
			: "chats";
	function setTab(next: string) {
		if (next === tab) return;
		const url = new URL(window.location.href);
		if (next === "chats") url.searchParams.delete("tab");
		else url.searchParams.set("tab", next);
		window.history.pushState(null, "", url);
	}
	const [sort, setSort] = useState("recent");
	async function toggleStar(id: string, starred: boolean) {
		setStarFailed(false);
		try {
			await saveSettings(id, { starred });
			reload();
		} catch {
			setStarFailed(true);
		}
	}
	const projects = data?.projects ?? [];
	const project = projects.find((p) => p.id === scope);
	const title =
		scope === ORDINARY
			? t("projects.ordinary")
			: scope
				? project?.name
				: t("projects.all");
	const missing = scope && scope !== ORDINARY && data && !project;
	const cards = scope
		? (data?.conversations ?? []).map((c) => ({
				id: c.id,
				href: `${projectPath(scope)}/chat/${c.id}`,
				title: c.title || t("lens.newChat"),
				preview: c.preview,
				updated: c.updated_at,
				starred: false,
			}))
		: projects.map((p) => ({
				id: p.id,
				href: projectPath(p.id),
				title: p.name,
				preview: p.latest,
				updated: p.updated_at,
				starred: p.starred,
			}));
	const visible = cards.sort((a, b) =>
		sort === "name"
			? a.title.localeCompare(b.title)
			: (b.updated ?? "").localeCompare(a.updated ?? ""),
	);
	return (
		<>
			<main className="pr-main">
				{scope && (
					<div className="pr-top">
						<Link href="/">{t("projects.all")}</Link>
						{scope && title && <span> / {title}</span>}
					</div>
				)}
				{!missing && (
					<header className="pr-header">
						<div className="flex min-w-0 items-center gap-2">
							<h1>
								{scope ? <Folder /> : <Folders />}
								{title}
							</h1>
							{project && (
								<ProjectForm
									project={project}
									onSaved={reload}
									onRemoved={() => router.push("/")}
								/>
							)}
						</div>
						{!scope && (
							<ProjectForm onSaved={(id) => router.push(projectPath(id))} />
						)}
						{tab === "chats" && scope && (project || scope === ORDINARY) && (
							<NewChat scope={scope} />
						)}
					</header>
				)}
				{(failed || starFailed) && (
					<div role="alert">
						{t("projects.failed")}{" "}
						<Button
							variant="secondary"
							size="sm"
							onClick={() => {
								setStarFailed(false);
								reload();
							}}
						>
							{t("projects.retry")}
						</Button>
					</div>
				)}
				{!data && !failed && <WorkspaceLoading />}
				{missing && <NotFound title={t("projects.missing")} />}
				{data && !missing && (
					<>
						<div className="pr-tools">
							{scope && (
								<nav className="pr-tabs">
									<Button
										variant="quiet"
										size="sm"
										aria-pressed={tab === "chats"}
										onClick={() => setTab("chats")}
									>
										{t("projects.chats")}
									</Button>
									<Button
										variant="quiet"
										size="sm"
										aria-pressed={tab === "memories"}
										onClick={() => setTab("memories")}
									>
										{t(
											scope === ORDINARY
												? "library.globalTitle"
												: "library.projectTitle",
										)}
									</Button>
									{project && (
										<Button
											variant="quiet"
											size="sm"
											aria-pressed={tab === "files"}
											onClick={() => setTab("files")}
										>
											{t("projectFiles.tab")}
										</Button>
									)}
								</nav>
							)}
							{tab === "chats" && (
								<div className="pr-layout">
									<MenuSelect
										label={t("projects.sort")}
										value={sort}
										onChange={setSort}
										options={[
											{ value: "recent", label: t("projects.modified") },
											{ value: "name", label: t("projects.name") },
										]}
									/>
									<Button
										variant="quiet"
										size="icon-sm"
										aria-label={t("projects.grid")}
										aria-pressed={!list}
										onClick={() => setList(false)}
									>
										<LayoutGrid />
									</Button>
									<Button
										variant="quiet"
										size="icon-sm"
										aria-label={t("projects.list")}
										aria-pressed={list}
										onClick={() => setList(true)}
									>
										<List />
									</Button>
								</div>
							)}
						</div>
						{tab === "memories" && scope ? (
							<MemoryLibrary projectScope={scope} />
						) : tab === "files" && project ? (
							<ProjectFolders project={project.id} />
						) : visible.length ? (
							<div className={`pr-grid${list ? " pr-list" : ""}`}>
								{visible.map((c) => (
									<ProjectCard
										key={c.id}
										{...c}
										project={!scope}
										onStar={
											scope ? undefined : () => toggleStar(c.id, !c.starred)
										}
									/>
								))}
							</div>
						) : (
							<div className="pr-empty">
								{scope ? <MessageSquare /> : <Folder />}
								<p>{t(scope ? "projects.emptyChats" : "projects.empty")}</p>
								{!scope && (
									<ProjectForm onSaved={(id) => router.push(projectPath(id))} />
								)}
							</div>
						)}
					</>
				)}
			</main>
		</>
	);
}
