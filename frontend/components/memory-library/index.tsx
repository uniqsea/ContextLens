"use client";

import { Import, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { ScopeBar } from "@/components/lens/scope-bar";
import { useOverview } from "@/components/lens/use-overview";
import { useScope } from "@/components/lens/use-scope";
import { LocaleSwitch } from "@/components/locale-switch";
import { memoryApi } from "@/lib/memory-api";
import type { MemoryRecord } from "@/lib/memory-types";
import { ConceptBar } from "./concept-bar";
import { ImportDialog } from "./import-dialog";
import { MemoryCard } from "./memory-card";
import { MemoryDetail } from "./memory-detail";
import { Timeline } from "./timeline";

export function MemoryLibrary() {
	const t = useTranslations("library");
	const { scope, chooseScope } = useScope();
	const overview = useOverview(scope);
	const [view, setView] = useState<"memories" | "timeline">("memories");
	const [version, setVersion] = useState(0);
	// The memory whose details are open, or "new" for the form that adds one.
	const [opened, setOpened] = useState<string | null>(null);
	const [error, setError] = useState("");
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

		startTransition(() => {
			memoryApi
				.list(scope)
				.then((list) => {
					if (!cancelled) setMemories(list);
				})
				.catch(() => setError(t("actionFailed")));
		});

		return () => {
			cancelled = true;
		};
	}, [t, scope]);

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
		setMemories(await memoryApi.list(scope));
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

	return (
		<main className="lens-theme lens-page">
			<div className="lib">
				<header className="lib-top">
					<Link href="/" className="lens-mark">
						<BrandLogo />
					</Link>
					{overview.data && (
						<ScopeBar
							projects={overview.data.projects}
							scope={scope}
							onScope={(next) => {
								chooseScope(next);
								setConcept(null);
								setFilter("all");
							}}
							onChanged={overview.reload}
						/>
					)}
					<div className="lib-top-right">
						<LocaleSwitch className="lens-seg" />
						<Link href="/" className="lens-btn outline">
							{t("backToAssistant")}
						</Link>
					</div>
				</header>

				<div className="lib-hero">
					<h1>
						{t("title")}
						{view === "memories" && (
							<small aria-live="polite">
								{isPending
									? t("loading")
									: t("count", { count: visibleMemories.length })}
							</small>
						)}
					</h1>
					<div className="lib-hero-tools">
						<div role="tablist" className="lens-seg">
							{(["memories", "timeline"] as const).map((v) => (
								<button
									key={v}
									type="button"
									role="tab"
									aria-selected={view === v}
									onClick={() => setView(v)}
								>
									{t(v === "memories" ? "tabMemories" : "tabTimeline")}
								</button>
							))}
						</div>
						{view === "memories" && (
							<>
								<button
									type="button"
									className="lens-btn outline"
									onClick={() => setImporting(true)}
								>
									<Import aria-hidden="true" />
									{t("import")}
								</button>
								<button
									type="button"
									className="lens-btn primary"
									onClick={() => setOpened("new")}
								>
									<Plus aria-hidden="true" />
									{t("add")}
								</button>
							</>
						)}
					</div>
				</div>
				{error && (
					<p role="alert" className="lens-alert">
						{error}
					</p>
				)}
				{view === "timeline" ? (
					<div className="lens-sheet-panel lib-timeline">
						<Timeline
							refreshKey={version}
							onChanged={() => void refreshMemories()}
						/>
					</div>
				) : (
					<>
						{/* biome-ignore lint/a11y/useSemanticElements: a filter strip, not a form section */}
						<div className="lib-filters" role="group" aria-label={t("title")}>
							{filters.map(({ id: item, label }) => (
								<button
									key={item}
									type="button"
									className="lens-chip"
									aria-pressed={filter === item}
									onClick={() => setFilter(item)}
								>
									{label}
								</button>
							))}
						</div>
						<ConceptBar
							concepts={overview.data?.concepts ?? []}
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
						{visibleMemories.length === 0 ? (
							<div className="lib-empty">{t("empty")}</div>
						) : (
							<div className="lib-grid">
								{visibleMemories.map((memory) => (
									<MemoryCard
										key={memory.id}
										memory={memory}
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
			</div>
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
		</main>
	);
}
