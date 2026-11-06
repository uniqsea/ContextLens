"use client";
import { Folder, Folders, LayoutGrid, List, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MenuSelect } from "@/components/lens/menu-select";
import { InlineLoading, NotFound } from "@/components/page-status";
import { Button } from "@/components/ui/button";
import { saveSettings } from "@/lib/projects/settings";
import { ORDINARY, projectPath } from "@/lib/projects/types";
import { NewChat } from "./new-chat";
import { ProjectCard } from "./project-card";
import { ProjectDetails } from "./project-details";
import { ProjectFolders } from "./project-folders";
import { ProjectForm } from "./project-form";
import { ProjectSidebar } from "./sidebar";
import { useDirectory } from "./use-directory";
import "./workspace.css";

export function ProjectWorkspace({ scope }: { scope?: string }) {
	const t = useTranslations();
	const router = useRouter();
	const { data, failed, reload } = useDirectory(scope);
	const [starFailed, setStarFailed] = useState(false);
	const [query, setQuery] = useState("");
	const [list, setList] = useState(false);
	const [tab, setTab] = useState("chats");
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
	const matches = (value: string) =>
		value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
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
	const visible = cards
		.filter((c) => matches(c.title) || matches(c.preview ?? ""))
		.sort((a, b) =>
			sort === "name"
				? a.title.localeCompare(b.title)
				: (b.updated ?? "").localeCompare(a.updated ?? ""),
		);
	return (
		<div className="lens-page pr-workspace">
			<ProjectSidebar
				scope={scope}
				projects={projects}
				query={query}
				onQuery={(v) => {
					setQuery(v);
					setTab("chats");
				}}
			/>
			<main className="pr-main">
				{scope && (
					<div className="pr-top">
						<Link href="/">{t("projects.all")}</Link>
						{scope && title && <span> / {title}</span>}
					</div>
				)}
				{!missing && (
					<header className="pr-header">
						<h1>
							{scope ? <Folder /> : <Folders />}
							{title}
						</h1>
						{!scope ? (
							<ProjectForm onSaved={(id) => router.push(projectPath(id))} />
						) : (
							(project || scope === ORDINARY) && (
								<div className="pr-folder-actions">
									{project && (
										<ProjectForm
											project={project}
											onSaved={reload}
											onRemoved={() => router.push("/")}
										/>
									)}
									<NewChat scope={scope} />
								</div>
							)
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
				{!data && !failed && <InlineLoading />}
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
										render={<Link href={`${projectPath(scope)}/memories`} />}
										nativeButton={false}
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
									{project && (
										<Button
											variant="quiet"
											size="sm"
											aria-pressed={tab === "details"}
											onClick={() => setTab("details")}
										>
											{t("projects.details")}
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
						{tab === "files" && project ? (
							<ProjectFolders project={project.id} />
						) : tab === "details" && project ? (
							<ProjectDetails project={project} onChanged={reload} />
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
								<p>
									{t(
										query
											? "projects.noMatch"
											: scope
												? "projects.emptyChats"
												: "projects.empty",
									)}
								</p>
								{!scope && !query && (
									<ProjectForm onSaved={(id) => router.push(projectPath(id))} />
								)}
							</div>
						)}
					</>
				)}
			</main>
		</div>
	);
}
