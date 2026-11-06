"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleChevron,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Item, ItemGroup } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { SearchField } from "@/components/ui/search-field";
import type { ModelInfo, ProviderRow } from "@/lib/model-settings";
import { cn } from "@/lib/utils";
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
			<SearchField
				label={t("search", { count: providers.length })}
				value={query}
				onValueChange={setQuery}
			/>
			<ItemGroup variant="panel">
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
					<p className="px-3 py-2 text-[13px] text-muted-foreground">
						{t("noMatch")}
					</p>
				)}
			</ItemGroup>
			{!q && !all && (
				<Button
					type="button"
					variant="outline"
					className="w-full"
					onClick={() => setAll(true)}
				>
					{t("showAll")}
				</Button>
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
		<Collapsible
			// biome-ignore lint/a11y/useSemanticElements: ItemGroup is a div list, as in shadcn
			render={<div role="listitem" />}
			open={open}
			onOpenChange={setOpen}
		>
			<Item
				variant="menu"
				render={<CollapsibleTrigger />}
				className="min-h-11 flex-nowrap justify-between py-0 pr-2 pl-3"
			>
				<span className="text-sm font-medium tracking-[-0.005em]">
					{p.name}
				</span>
				<span className="flex items-center gap-3 text-[12.5px] whitespace-nowrap text-muted-foreground">
					{t("models", { count: p.model_count })}
					<span
						className={cn(
							"inline-flex items-center gap-1.5",
							p.connected && "font-medium text-foreground",
						)}
					>
						<span
							aria-hidden
							className={cn(
								"size-[7px] rounded-full",
								p.connected
									? "bg-hist"
									: "ring-1 ring-muted-foreground ring-inset",
							)}
						/>
						{p.connected ? t("connected") : t("notConnected")}
					</span>
					<CollapsibleChevron className="size-[15px]" />
				</span>
			</Item>
			<CollapsibleContent className="grid gap-3 px-3 pt-1.5 pb-3">
				<form
					className="grid gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						save();
					}}
				>
					<Label>
						{t("apiKey")}
						<Input
							type="password"
							autoComplete="off"
							value={key}
							onChange={(e) => setKey(e.target.value)}
							placeholder={
								p.connected ? t("apiKeyKeep") : t("apiKeyPlaceholder")
							}
						/>
					</Label>
					<Label>
						{t("baseUrl")}
						<Input
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder={t("baseUrlHint", {
								url: p.default_base_url ?? "",
							})}
							className="font-mono text-xs"
						/>
					</Label>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="submit"
							disabled={busy || (!key && !p.connected)}
							variant="default"
						>
							{t("save")}
						</Button>
						{p.connected && (
							<Button
								type="button"
								variant="danger"
								onClick={() => onForget(p.id)}
							>
								{t("forget")}
							</Button>
						)}
						{p.doc && (
							<a
								href={p.doc}
								target="_blank"
								rel="noreferrer"
								className="text-[13px] text-muted-foreground underline-offset-3 hover:text-foreground hover:underline"
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
			</CollapsibleContent>
		</Collapsible>
	);
}
