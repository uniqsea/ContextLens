"use client";

import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { LocaleSwitch } from "../locale-switch";

/** Settings people rarely change: the interface language, their situations, and the models. */
export function SettingsMenu({
	onManageModels,
	onManageSituations,
}: {
	onManageModels: () => void;
	onManageSituations: () => void;
}) {
	const t = useTranslations("lens");
	const [open, setOpen] = useState(false);
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
