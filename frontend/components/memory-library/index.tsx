"use client";

import { Import, Library, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useWorkspaceDirectory } from "@/components/projects/use-directory";
import { MenuSelect } from "@/components/lens/menu-select";
import { useOverview } from "@/components/lens/use-overview";
import { WorkspaceLoading } from "@/components/page-status";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { memoryApi } from "@/lib/memory-api";
import type { MemoryRecord } from "@/lib/memory-types";
import { ORDINARY } from "@/lib/projects/types";
import { ConceptBar } from "./concept-bar";
import { ImportDialog } from "./import-dialog";
import { MemoryCard } from "./memory-card";
import { MemoryDetail } from "./memory-detail";
import { Timeline } from "./timeline";

interface LibraryProps {
	projectScope?: string;
}

export function MemoryLibrary(props: LibraryProps) {
	const [view, setView] = useState<"memories" | "timeline">("memories");
	const [selected, setSelected] = useState("all");
	const owner =
		props.projectScope ?? (selected === "all" ? undefined : selected);
	const directory = useWorkspaceDirectory();
	return (
		<LibraryView
			key={owner ?? "all"}
			{...props}
			owner={owner}
			directory={directory}
			onSelect={setSelected}
			view={view}
			setView={setView}
		/>
	);
}

function LibraryView({
	projectScope,
	owner,
	directory,
	onSelect,
	view,
	setView,
}: LibraryProps & {
	view: "memories" | "timeline";
	setView: (view: "memories" | "timeline") => void;
	owner?: string;
	directory: ReturnType<typeof useWorkspaceDirectory>;
	onSelect: (value: string) => void;
}) {
	const nav = useTranslations("projects");
	const t = useTranslations("library");
	const scope = owner ?? ORDINARY;
	const overview = useOverview(scope);
	const projects = directory.data?.projects ?? [];
	const title =
		projectScope === ORDINARY
			? t("globalTitle")
			: projectScope
				? t("projectTitle")
				: t("title");
	const [version, setVersion] = useState(0);
	// The memory whose details are open, or "new" for the form that adds one.
	const [opened, setOpened] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [loaded, setLoaded] = useState(false);
	const [memories, setMemories] = useState<MemoryRecord[]>([]);
	// "all", "trashed", or the name of a scene.
	const [filter, setFilter] = useState("all");
	const [concept, setConcept] = useState<string | null>(null);
	const [picking, setPicking] = useState(false);
	const [picked, setPicked] = useState<string[]>([]);
	const [importing, setImporting] = useState(false);
	const [isPending, startTransition] = useTransition();

	useEffect(() => {
		let cancelled = false;

		startTransition(async () => {
			await memoryApi
				.list(owner)
				.then((list) => {
					if (!cancelled) {
						setMemories(list);
						setLoaded(true);
					}
				})
				.catch(() => setError(t("actionFailed")));
		});

		return () => {
			cancelled = true;
		};
	}, [t, owner]);

	const visibleMemories = useMemo(() => {
		if (filter === "trashed") {
			return memories.filter((memory) => memory.lifecycle_state === "trashed");
		}
		const active = memories.filter(
			(m) =>
				m.lifecycle_state === "active" &&
				(!concept || m.concepts.some((c) => c.id === concept)),
		);
		return filter === "all"
			? active
			: active.filter((memory) => memory.scenes.includes(filter));
	}, [filter, concept, memories]);
	const concepts = useMemo(() => {
		const counts = new Map<
			string,
			{ id: string; name: string; aliases: string[]; count: number }
		>();
		for (const memory of memories) {
			if (memory.lifecycle_state !== "active") continue;
			for (const c of memory.concepts) {
				const entry = counts.get(c.id);
				if (entry) entry.count++;
				else
					counts.set(c.id, {
						...c,
						aliases:
							overview.data?.concepts.find((item) => item.id === c.id)
								?.aliases ?? [],
						count: 1,
					});
			}
		}
		return [...counts.values()].sort(
			(a, b) => b.count - a.count || a.name.localeCompare(b.name),
		);
	}, [memories, overview.data]);
	const openedMemory = memories.find((m) => m.id === opened);
	const filters = [
		{ id: "all", label: t("all") },
		...(overview.data?.scenes ?? []).map((s) => ({
			id: s.name,
			label: s.name,
		})),
		{ id: "trashed", label: t("trash") },
	];

	// Every change reloads the list and any history on screen, which now include it.
	const refreshMemories = async () => {
		setMemories(await memoryApi.list(owner));
		setVersion((v) => v + 1);
		overview.reload();
	};

	const runAction = async (change: () => Promise<unknown>) => {
		try {
			await change();
		} catch {
			setError(t("actionFailed"));
			return;
		}
		setError("");
		await refreshMemories();
	};

	const emptyProject =
		Boolean(projectScope) && loaded && memories.length === 0 && !error;
	const actions = owner && view === "memories" && (
		<div className="lib-hero-tools">
			<Button
				type="button"
				variant="outline"
				onClick={() => setImporting(true)}
			>
				<Import aria-hidden="true" />
				{t("import")}
			</Button>
			<Button type="button" variant="default" onClick={() => setOpened("new")}>
				<Plus aria-hidden="true" />
				{t("add")}
			</Button>
		</div>
	);

	return (
		<>
			<section aria-label={title}>
				{!projectScope && (
					<nav className="pr-top lib-path" aria-label={nav("all")}>
						<Link href="/">{nav("all")}</Link>
						<span aria-hidden="true">/</span>
						<span aria-current="page">{title}</span>
					</nav>
				)}
				{!projectScope && (
					<header className="pr-header">
						<h1>
							<Library aria-hidden="true" />
							{title}
						</h1>

						<div className="lib-hero-tools">
							<MenuSelect
								label={t("projectFilter")}
								value={owner ?? "all"}
								onChange={onSelect}
								options={[
									{ value: "all", label: nav("all") },
									{ value: ORDINARY, label: t("global") },
									...projects.map((p) => ({ value: p.id, label: p.name })),
								]}
							/>

							{actions}
						</div>
					</header>
				)}
				<div
					className={
						projectScope
							? "flex flex-wrap items-center justify-between gap-3 border-t border-border py-3"
							: "pr-tools"
					}
				>
					<div className="flex flex-wrap items-center gap-2">
						<fieldset aria-label={title} className="pr-tabs">
							{(["memories", "timeline"] as const).map((v) => (
								<Button
									key={v}
									variant="quiet"
									size="sm"
									aria-pressed={view === v}
									onClick={() => setView(v)}
								>
									{t(v === "memories" ? "tabMemories" : "tabTimeline")}
								</Button>
							))}
						</fieldset>
						{projectScope && view === "memories" && memories.length > 0 && (
							<MenuSelect
								label={t("filterMemories")}
								value={filter}
								onChange={setFilter}
								options={filters.map((f) => ({ value: f.id, label: f.label }))}
							/>
						)}
					</div>
					{projectScope && !emptyProject && (loaded || error) && actions}
					{!projectScope && loaded && view === "memories" && (
						<small className="lib-count" aria-live="polite">
							{isPending
								? t("loading")
								: t("count", { count: visibleMemories.length })}
						</small>
					)}
				</div>
				{error && <Alert variant="destructive">{error}</Alert>}
				{view === "timeline" ? (
					<div className="lens-sheet-panel lib-timeline">
						<Timeline
							scope={owner}
							refreshKey={version}
							onChanged={() => void refreshMemories()}
						/>
					</div>
				) : (
					<>
						{!projectScope && (
							<fieldset className="lib-filters" aria-label={t("title")}>
								{filters.map(({ id: item, label }) => (
									<Button
										key={item}
										type="button"
										variant="secondary"
										size="sm"
										aria-pressed={filter === item}
										onClick={() => setFilter(item)}
									>
										{label}
									</Button>
								))}
							</fieldset>
						)}
						<ConceptBar
							concepts={concepts}
							selected={concept}
							onSelect={(id) => {
								setConcept(id);
								setPicking(false);
							}}
							picking={picking}
							picked={picked}
							onPicking={(on) => {
								setPicking(on);
								setPicked([]);
							}}
							onChange={(change) => void runAction(change)}
						/>
						{!loaded ? (
							error ? null : (
								<WorkspaceLoading />
							)
						) : visibleMemories.length === 0 ? (
							<div
								className={
									projectScope
										? "grid justify-items-center gap-3 py-12 text-muted-foreground"
										: "pr-empty"
								}
							>
								<Library aria-hidden="true" />
								<p>
									{emptyProject
										? t(
												projectScope === ORDINARY
													? "emptyGlobal"
													: "emptyProject",
											)
										: t("empty")}
								</p>
								{emptyProject && actions}
							</div>
						) : (
							<div className="lib-grid">
								{visibleMemories.map((memory) => (
									<MemoryCard
										key={memory.id}
										memory={memory}
										owner={
											memory.scope === ORDINARY
												? t("global")
												: (projects.find((p) => p.id === memory.scope)?.name ??
													memory.scope)
										}
										onOpen={() => setOpened(memory.id)}
										picking={picking}
										picked={picked.includes(memory.id)}
										onPick={() =>
											setPicked(
												picked.includes(memory.id)
													? picked.filter((id) => id !== memory.id)
													: [...picked, memory.id],
											)
										}
									/>
								))}
							</div>
						)}
					</>
				)}
			</section>
			{importing && (
				<ImportDialog
					scope={scope}
					onClose={() => setImporting(false)}
					onChanged={() => void refreshMemories()}
				/>
			)}
			{(opened === "new" || openedMemory) && (
				<MemoryDetail
					key={opened}
					memory={openedMemory}
					scope={scope}
					sceneOptions={overview.data?.scenes ?? []}
					refreshKey={version}
					error={error}
					onClose={() => setOpened(null)}
					onChange={(change) => void runAction(change)}
					onChanged={() => void refreshMemories()}
				/>
			)}
		</>
	);
}
