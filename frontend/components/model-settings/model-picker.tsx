"use client";

import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { SettingsIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Combobox,
	ComboboxCollection,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxGroup,
	ComboboxItem,
	ComboboxLabel,
	ComboboxList,
	ComboboxTrigger,
} from "@/components/ui/combobox";
import { SearchField } from "@/components/ui/search-field";
import { type ModelInfo, settingsApi } from "@/lib/model-settings";
import type { ModelSettings } from "./use-model-settings";

type Group = { id: string; name: string; models: ModelInfo[] };

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

	const searchRef = useRef<HTMLInputElement>(null);
	const connected = overview?.providers.filter((p) => p.connected) ?? [];
	const connectedKey = connected.map((p) => p.id).join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the connected set changes
	useEffect(() => {
		let live = true;
		Promise.all(
			connected.map(async (p) => ({
				id: p.id,
				name: p.name,
				models: (await loadModels(p.id)).filter((m) => m.kind === "chat"),
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
	const choices = groups.map((g) => ({
		label: g.name,
		items: g.models.map((model) => ({
			value: g.id + "/" + model.id,
			label: model.name,
			provider: g.name,
			model,
		})),
	}));
	const all = choices.flatMap((group) => group.items);
	const active = all.find((item) => item.value === selected);
	const listed = choices
		.map((group) => ({
			...group,
			items: group.items.filter(
				(item) => searching || item.model.shown || item === active,
			),
		}))
		.filter((group) => group.items.length);
	const effort = active?.model.efforts?.find(
		(id) => id === overview.efforts.agent,
	);
	const effortName = (id: string) => t(`effort.${id}` as "effort.low");
	function changeOpen(next: boolean) {
		setOpen(next);
		if (!next) setQuery("");
	}
	if (!connected.length)
		return (
			<Button
				variant="ghost"
				size="sm"
				className="lens-model-connect"
				onClick={onManage}
			>
				{t("picker.connect")}
			</Button>
		);
	return (
		<Combobox
			items={listed}
			open={open}
			onOpenChange={changeOpen}
			value={active ?? null}
			isItemEqualToValue={(a, b) => a.value === b.value}
			onValueChange={(item) => {
				if (item) void run(() => settingsApi.setRoles({ agent: item.value }));
			}}
			inputValue={query}
			onInputValueChange={setQuery}
			autoHighlight
			filter={(item, search) =>
				`${item.label} ${item.value} ${item.provider}`
					.toLowerCase()
					.includes(search.trim().toLowerCase())
			}
		>
			<ComboboxTrigger
				render={<Button variant="ghost" size="sm" />}
				className="lens-model-trigger"
				aria-label={t("roles.agent.name")}
			>
				<span className="truncate">
					{active?.label ?? selected ?? t("picker.placeholder")}
				</span>
				{effort && (
					<span className="text-muted-foreground">{effortName(effort)}</span>
				)}
			</ComboboxTrigger>
			<ComboboxContent
				align="start"
				side="top"
				initialFocus={searchRef}
				className="w-80"
			>
				<div className="px-2.5 pt-2.5 pb-1">
					<BaseCombobox.Input
						ref={searchRef}
						render={<SearchField label={t("picker.search")} />}
					/>
				</div>
				<ComboboxEmpty>{t("picker.empty")}</ComboboxEmpty>
				<ComboboxList>
					{(group: (typeof listed)[number]) => (
						<ComboboxGroup key={group.label} items={group.items}>
							<ComboboxLabel>{group.label}</ComboboxLabel>
							<ComboboxCollection>
								{(item: (typeof all)[number]) => (
									<ComboboxItem key={item.value} value={item}>
										{item.label}
									</ComboboxItem>
								)}
							</ComboboxCollection>
						</ComboboxGroup>
					)}
				</ComboboxList>
				{!!active?.model.efforts?.length && (
					<div className="flex items-center justify-between gap-2 border-t px-3 py-2">
						<span className="text-xs text-muted-foreground">
							{t("picker.thinking")}
						</span>
						<RadioGroup
							value={effort ?? ""}
							onValueChange={(value: string) =>
								void run(() => settingsApi.setEfforts({ agent: value }))
							}
							aria-label={t("picker.thinking")}
							aria-orientation="horizontal"
							className="flex flex-wrap"
							onKeyDown={(e) => {
								if (e.key === "ArrowDown" || e.key === "ArrowUp") {
									e.preventBaseUIHandler();
									searchRef.current?.focus();
								}
								if (e.key === "Home" || e.key === "End") {
									e.preventDefault();
									e.stopPropagation();
									const radios =
										e.currentTarget.querySelectorAll<HTMLElement>(
											'[role="radio"]',
										);
									const target =
										radios[e.key === "Home" ? 0 : radios.length - 1];
									target?.focus();
									target?.click();
								}
							}}
						>
							{active.model.efforts.map((id) => (
								<Radio.Root
									key={id}
									value={id}
									render={<Button variant="ghost" size="xs" />}
									className="data-checked:bg-accent"
								>
									{effortName(id)}
								</Radio.Root>
							))}
						</RadioGroup>
					</div>
				)}

				<Button
					variant="ghost"
					className="w-full justify-start rounded-none border-t"
					onClick={() => {
						changeOpen(false);
						onManage();
					}}
				>
					<SettingsIcon />
					{t("picker.manage")}
				</Button>
			</ComboboxContent>
		</Combobox>
	);
}
