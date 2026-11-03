"use client";

import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { type MemoryLanguage, settingsApi } from "@/lib/model-settings";
import { LocaleSwitch } from "../locale-switch";

const CHOICES = ["follow", "zh", "en"] as const;

/** Settings people rarely change: the interface and memory languages, their situations, and the models. */
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
	useEffect(() => {
		if (open) settingsApi.memoryLanguage().then(setMemoryLanguage, () => {});
	}, [open]);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				className="lens-icon-btn"
				aria-label={t("settingsMenu")}
				title={t("settingsMenu")}
			>
				<Settings aria-hidden="true" />
			</PopoverTrigger>
			<PopoverContent
				align="end"
				sideOffset={6}
				className="lens-theme lens-menu"
			>
				<div className="lens-menu-row">
					<span>{t("language")}</span>
					<LocaleSwitch className="lens-seg" />
				</div>
				{memoryLanguage && (
					<div
						className="lens-menu-row"
						title={
							memoryLanguage.rewriting
								? t("memoryLanguageRewriting")
								: undefined
						}
					>
						<span>{t("memoryLanguage")}</span>
						{/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form section */}
						<div
							className="lens-seg"
							role="group"
							aria-label={t("memoryLanguage")}
							aria-busy={memoryLanguage.rewriting}
						>
							{CHOICES.map((c) => (
								<button
									key={c}
									type="button"
									aria-pressed={memoryLanguage.choice === c}
									onClick={() => {
										if (c === memoryLanguage.choice) return;
										settingsApi
											.setMemoryLanguage(c)
											.then(setMemoryLanguage, () => {});
									}}
								>
									{c === "follow" ? t("memoryLanguageFollow") : tl(c)}
								</button>
							))}
						</div>
					</div>
				)}
				<button
					type="button"
					className="lens-menu-item"
					onClick={() => {
						setOpen(false);
						onManageSituations();
					}}
				>
					{t("manageSituations")}
				</button>
				<button
					type="button"
					className="lens-menu-item"
					onClick={() => {
						setOpen(false);
						onManageModels();
					}}
				>
					{t("manageModels")}
				</button>
			</PopoverContent>
		</Popover>
	);
}
