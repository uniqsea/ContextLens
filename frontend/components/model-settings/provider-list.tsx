"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ModelInfo, ProviderRow } from "@/lib/model-settings";
import { ModelChooser } from "./model-chooser";

type ChooserProps = {
	loadModels: (provider: string) => Promise<ModelInfo[]>;
	modelsVersion: number;
	onChooseShown: (provider: string, models: string[] | null) => Promise<void>;
};

/** Shown before any search: the providers most people start with, when the catalog has them. */
const FEATURED = [
	"deepseek",
	"openai",
	"moonshotai",
	"alibaba",
	"zhipuai",
	"openrouter",
	"siliconflow",
];

export function ProviderList({
	providers,
	onSave,
	onForget,
	...chooser
}: {
	providers: ProviderRow[];
	onSave: (
		id: string,
		body: { api_key?: string; base_url?: string },
	) => Promise<void>;
	onForget: (id: string) => Promise<void>;
} & ChooserProps) {
	const t = useTranslations("settings");
	const [query, setQuery] = useState("");
	const [all, setAll] = useState(false);
	const q = query.trim().toLowerCase();
	const shown = providers.filter((p) =>
		q
			? p.name.toLowerCase().includes(q) || p.id.includes(q)
			: all || p.connected || FEATURED.includes(p.id),
	);

	return (
		<section aria-label={t("providersTitle")} className="grid gap-2">
			<input
				type="search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder={t("search", { count: providers.length })}
				aria-label={t("search", { count: providers.length })}
				className="lens-input is-pill"
			/>
			<ul className="lens-group">
				{shown.map((p) => (
					<ProviderItem
						key={p.id}
						provider={p}
						onSave={onSave}
						onForget={onForget}
						{...chooser}
					/>
				))}
				{shown.length === 0 && (
					<li className="lens-provider-form lib-hint">{t("noMatch")}</li>
				)}
			</ul>
			{!q && !all && (
				<button
					type="button"
					className="lens-btn outline block"
					onClick={() => setAll(true)}
				>
					{t("showAll")}
				</button>
			)}
		</section>
	);
}

function ProviderItem({
	provider: p,
	onSave,
	onForget,
	loadModels,
	modelsVersion,
	onChooseShown,
}: {
	provider: ProviderRow;
	onSave: (
		id: string,
		body: { api_key?: string; base_url?: string },
	) => Promise<void>;
	onForget: (id: string) => Promise<void>;
} & ChooserProps) {
	const t = useTranslations("settings");
	const [open, setOpen] = useState(false);
	const [key, setKey] = useState("");
	const [url, setUrl] = useState(
		p.base_url === p.default_base_url ? "" : (p.base_url ?? ""),
	);
	const [busy, setBusy] = useState(false);
	const save = async () => {
		setBusy(true);
		try {
			await onSave(p.id, { ...(key ? { api_key: key } : {}), base_url: url });
			setKey("");
			setOpen(false);
		} finally {
			setBusy(false);
		}
	};

	return (
		<li>
			<button
				type="button"
				className="lens-provider-row"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
			>
				<span>{p.name}</span>
				<span>
					{t("models", { count: p.model_count })}
					<span className="lens-status" data-on={p.connected}>
						{p.connected ? t("connected") : t("notConnected")}
					</span>
					<ChevronRight aria-hidden="true" />
				</span>
			</button>
			{open && (
				<div className="lens-provider-form">
					<form
						className="grid gap-3"
						onSubmit={(e) => {
							e.preventDefault();
							save();
						}}
					>
						<label className="lens-field">
							{t("apiKey")}
							<input
								type="password"
								autoComplete="off"
								value={key}
								onChange={(e) => setKey(e.target.value)}
								placeholder={
									p.connected ? t("apiKeyKeep") : t("apiKeyPlaceholder")
								}
								className="lens-input"
							/>
						</label>
						<label className="lens-field">
							{t("baseUrl")}
							<input
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								placeholder={t("baseUrlHint", {
									url: p.default_base_url ?? "",
								})}
								className="lens-input lens-code-input"
							/>
						</label>
						<div className="lens-row-end">
							<button
								type="submit"
								disabled={busy || (!key && !p.connected)}
								className="lens-btn primary"
							>
								{t("save")}
							</button>
							{p.connected && (
								<button
									type="button"
									className="lens-btn danger"
									onClick={() => onForget(p.id)}
								>
									{t("forget")}
								</button>
							)}
							{p.doc && (
								<a
									href={p.doc}
									target="_blank"
									rel="noreferrer"
									className="lens-link"
								>
									{t("docs")}
								</a>
							)}
						</div>
					</form>
					{p.connected && (
						<ModelChooser
							provider={p.id}
							loadModels={loadModels}
							modelsVersion={modelsVersion}
							onChange={onChooseShown}
						/>
					)}
				</div>
			)}
		</li>
	);
}
