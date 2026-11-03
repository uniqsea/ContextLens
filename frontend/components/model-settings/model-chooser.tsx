"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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
		<fieldset className="lens-chooser">
			<legend>
				<span>
					{t("chooser.title", { count: shown.length, total: models.length })}
				</span>
				<button type="button" onClick={() => onChange(provider, null)}>
					{t("chooser.reset")}
				</button>
			</legend>
			<input
				type="search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder={t("chooser.search")}
				aria-label={t("chooser.search")}
				className="lens-input"
			/>
			<ul className="lens-check-list">
				{listed.map((m) => (
					<li key={m.id}>
						<label>
							<input
								type="checkbox"
								checked={m.shown}
								onChange={() => toggle(m.id)}
							/>
							<span>{m.name}</span>
							<small>{m.release_date ?? ""}</small>
						</label>
					</li>
				))}
			</ul>
		</fieldset>
	);
}
