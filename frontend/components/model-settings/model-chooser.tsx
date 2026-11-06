"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { Item } from "@/components/ui/item";
import { SearchField } from "@/components/ui/search-field";
import type { ModelInfo } from "@/lib/model-settings";

/** Which of a provider's chat models the picker offers; the catalog's current ones until changed. */
export function ModelChooser({
	provider,
	loadModels,
	modelsVersion,
	onChange,
}: {
	provider: string;
	loadModels: (provider: string) => Promise<ModelInfo[]>;
	modelsVersion: number;
	onChange: (provider: string, models: string[] | null) => Promise<void>;
}) {
	const t = useTranslations("settings");
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [query, setQuery] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload when the list changes
	useEffect(() => {
		let live = true;
		loadModels(provider).then(
			(list) => live && setModels(list.filter((m) => m.kind === "chat")),
		);
		return () => {
			live = false;
		};
	}, [provider, loadModels, modelsVersion]);

	const shown = models.filter((m) => m.shown).map((m) => m.id);
	const toggle = (id: string) =>
		onChange(
			provider,
			shown.includes(id) ? shown.filter((s) => s !== id) : [...shown, id],
		);
	const q = query.trim().toLowerCase();
	const listed = models.filter(
		(m) => !q || m.name.toLowerCase().includes(q) || m.id.includes(q),
	);

	return (
		<FieldSet className="min-w-0 gap-2">
			<FieldLegend
				variant="label"
				className="mb-2 flex w-full items-center justify-between gap-3"
			>
				<span>
					{t("chooser.title", { count: shown.length, total: models.length })}
				</span>
				<Button
					variant="quiet"
					size="xs"
					onClick={() => onChange(provider, null)}
				>
					{t("chooser.reset")}
				</Button>
			</FieldLegend>
			<SearchField
				label={t("chooser.search")}
				value={query}
				onValueChange={setQuery}
			/>
			<ul className="grid max-h-56 overflow-y-auto [scrollbar-width:thin]">
				{listed.map((m) => (
					<li key={m.id}>
						<Item
							variant="menu"
							size="xs"
							className="flex-nowrap"
							// biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox inside is the control
							render={<label />}
						>
							<Checkbox
								checked={m.shown}
								onCheckedChange={() => toggle(m.id)}
							/>
							<span className="min-w-0 flex-1 truncate">{m.name}</span>
							<small className="shrink-0 text-xs text-muted-foreground">
								{m.release_date ?? ""}
							</small>
						</Item>
					</li>
				))}
			</ul>
		</FieldSet>
	);
}
