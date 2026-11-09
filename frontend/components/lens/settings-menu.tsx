"use client";

import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Item } from "@/components/ui/item";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDensity } from "@/hooks/use-density";
import type { Density } from "@/lib/density";
import { type MemoryLanguage, settingsApi } from "@/lib/model-settings";
import { LocaleSwitch } from "../locale-switch";

const CHOICES = ["follow", "zh", "en"] as const;
const DENSITIES = ["standard", "compact"] as const;

/** Settings people rarely change: the interface language and density, the memory language, their situations, and the models. */
export function SettingsMenu({
	onManageModels,
	onManageSituations,
}: {
	onManageModels: () => void;
	onManageSituations: () => void;
}) {
	const t = useTranslations("lens");
	const tl = useTranslations("locale");
	const [open, setOpen] = useState(false);
	const [memoryLanguage, setMemoryLanguage] = useState<MemoryLanguage>();
	const [density, setDensity] = useDensity();
	useEffect(() => {
		if (open) settingsApi.memoryLanguage().then(setMemoryLanguage, () => {});
	}, [open]);
	const row =
		"flex items-center justify-between gap-4 py-1 pr-1 pl-2.5 text-muted-foreground";
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={<Button variant="quiet" size="icon-sm" />}
				aria-label={t("settingsMenu")}
				title={t("settingsMenu")}
			>
				<Settings aria-hidden="true" />
			</PopoverTrigger>
			<PopoverContent align="end" sideOffset={6} variant="menu">
				<div className={row}>
					<span className="whitespace-nowrap">{t("language")}</span>
					<LocaleSwitch />
				</div>
				<div className={row}>
					<span className="whitespace-nowrap">{t("density")}</span>
					<ToggleGroup
						variant="segment"
						spacing={0.5}
						aria-label={t("density")}
						value={[density]}
						onValueChange={(next) => {
							const d = next[0] as Density | undefined;
							if (d) setDensity(d);
						}}
					>
						{DENSITIES.map((d) => (
							<ToggleGroupItem key={d} value={d}>
								{t(d === "standard" ? "densityStandard" : "densityCompact")}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
				{memoryLanguage && (
					<div
						className={row}
						title={
							memoryLanguage.rewriting
								? t("memoryLanguageRewriting")
								: undefined
						}
					>
						<span className="whitespace-nowrap">{t("memoryLanguage")}</span>
						<ToggleGroup
							variant="segment"
							spacing={0.5}
							aria-label={t("memoryLanguage")}
							aria-busy={memoryLanguage.rewriting}
							value={[memoryLanguage.choice]}
							onValueChange={(next) => {
								const c = next[0] as (typeof CHOICES)[number] | undefined;
								if (!c || c === memoryLanguage.choice) return;
								settingsApi
									.setMemoryLanguage(c)
									.then(setMemoryLanguage, () => {});
							}}
						>
							{CHOICES.map((c) => (
								<ToggleGroupItem key={c} value={c}>
									{c === "follow" ? t("memoryLanguageFollow") : tl(c)}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</div>
				)}
				{(
					[
						["manageSituations", onManageSituations],
						["manageModels", onManageModels],
					] as const
				).map(([label, act]) => (
					<Item
						key={label}
						variant="menu"
						size="xs"
						render={<button type="button" />}
						onClick={() => {
							setOpen(false);
							act();
						}}
					>
						{t(label)}
					</Item>
				))}
			</PopoverContent>
		</Popover>
	);
}
