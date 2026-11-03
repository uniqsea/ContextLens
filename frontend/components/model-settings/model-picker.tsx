"use client";

import { SettingsIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
	type ModelOption,
	ModelSelectorContent,
	ModelSelectorEffort,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorRoot,
	ModelSelectorSearch,
	ModelSelectorTrigger,
	ModelSelectorValue,
} from "@/components/assistant-ui/elements/model-selector";
import { settingsApi } from "@/lib/model-settings";
import type { ModelSettings } from "./use-model-settings";

type Group = {
	id: string;
	name: string;
	models: (ModelOption & { shown: boolean })[];
};

/** The main model and its reasoning effort, chosen next to the input. `onManage` opens the
 * provider settings (owned by the page, which also opens them from its settings menu). */
export function ModelPicker({
	settings,
	onManage,
}: {
	settings: ModelSettings;
	onManage: () => void;
}) {
	const t = useTranslations("settings");
	const { overview, run, loadModels, modelsVersion } = settings;
	const [open, setOpen] = useState(false);
	const [groups, setGroups] = useState<Group[]>([]);
	const [query, setQuery] = useState("");

	const connected = overview?.providers.filter((p) => p.connected) ?? [];
	const connectedKey = connected.map((p) => p.id).join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the connected set changes
	useEffect(() => {
		let live = true;
		Promise.all(
			connected.map(async (p) => ({
				id: p.id,
				name: p.name,
				models: (await loadModels(p.id))
					.filter((m) => m.kind === "chat")
					.map((m) => ({
						id: `${p.id}/${m.id}`,
						name: m.name,
						shown: m.shown,
						keywords: [p.name, m.id],
						efforts: m.efforts?.map((id) => ({
							id,
							name: t(`effort.${id}` as "effort.low"),
						})),
					})),
			})),
		).then((next) => live && setGroups(next));
		return () => {
			live = false;
		};
	}, [connectedKey, loadModels, modelsVersion, t]);

	if (!overview) return null;
	// The models chosen per provider lead (and the selected one, always); the rest come up when searched.
	const selected = overview.roles.agent;
	const searching = query.trim() !== "";
	const hidden = groups
		.flatMap((g) => g.models)
		.filter((m) => !m.shown && m.id !== selected).length;
	if (connected.length === 0) {
		return (
			<button type="button" className="lens-model-connect" onClick={onManage}>
				{t("picker.connect")}
			</button>
		);
	}

	return (
		<ModelSelectorRoot
			models={groups.flatMap((g) => g.models)}
			value={overview.roles.agent ?? ""}
			onValueChange={(spec) => run(() => settingsApi.setRoles({ agent: spec }))}
			effort={overview.efforts.agent ?? ""}
			onEffortChange={(effort) =>
				run(() => settingsApi.setEfforts({ agent: effort }))
			}
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setQuery("");
			}}
		>
			<ModelSelectorTrigger
				variant="ghost"
				size="sm"
				className="lens-model-trigger"
				aria-label={t("roles.agent.name")}
			>
				<ModelSelectorValue placeholder={t("picker.placeholder")} />
			</ModelSelectorTrigger>
			<ModelSelectorContent side="top" searchable className="w-80">
				<ModelSelectorSearch
					placeholder={t("picker.search")}
					value={query}
					onValueChange={setQuery}
				/>
				<ModelSelectorList className="max-h-72">
					<ModelSelectorEmpty>{t("picker.empty")}</ModelSelectorEmpty>
					{groups.map((g) => (
						<ModelSelectorGroup key={g.id} heading={g.name}>
							{g.models
								.filter((m) => searching || m.shown || m.id === selected)
								.map((m) => (
									<ModelSelectorItem key={m.id} model={m} />
								))}
						</ModelSelectorGroup>
					))}
					{!searching && hidden > 0 && (
						<p className="px-3 py-2 text-xs text-muted-foreground">
							{t("picker.more", { count: hidden })}
						</p>
					)}
				</ModelSelectorList>
				<ModelSelectorEffort label={t("picker.thinking")} />
				<button
					type="button"
					className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
					onClick={() => {
						setOpen(false);
						onManage();
					}}
				>
					<SettingsIcon className="size-3.5" aria-hidden="true" />
					{t("picker.manage")}
				</button>
			</ModelSelectorContent>
		</ModelSelectorRoot>
	);
}
