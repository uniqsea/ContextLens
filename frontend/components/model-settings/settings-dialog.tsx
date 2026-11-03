"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { type Role, settingsApi } from "@/lib/model-settings";
import { ProviderList } from "./provider-list";
import { RolePicker } from "./role-picker";
import type { ModelSettings } from "./use-model-settings";

/** Connect providers; the models behind the background roles sit under "advanced". */
export function SettingsDialog({
	open,
	onOpenChange,
	settings: { overview, error, run, loadModels, modelsVersion, setShown },
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	settings: ModelSettings;
}) {
	const t = useTranslations("settings");
	const [advanced, setAdvanced] = useState(false);
	const connected = overview?.providers.filter((p) => p.connected) ?? [];
	const setRole = (role: Role) => (spec: string | null) =>
		run(() => settingsApi.setRoles({ [role]: spec }));

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="lens-theme lens-dialog flex max-h-[85dvh] flex-col gap-4 overflow-hidden sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{t("title")}</DialogTitle>
					<DialogDescription>{t("subtitle")}</DialogDescription>
				</DialogHeader>
				<div className="lens-dialog-scroll">
					{error && (
						<p role="alert" className="lens-alert">
							{t("error", { message: error })}
						</p>
					)}
					{overview && (
						<ProviderList
							providers={overview.providers}
							onSave={(id, body) =>
								run(() => settingsApi.saveProvider(id, body))
							}
							onForget={(id) => run(() => settingsApi.forgetProvider(id))}
							loadModels={loadModels}
							modelsVersion={modelsVersion}
							onChooseShown={setShown}
						/>
					)}
					{connected.length > 0 && overview && (
						<section>
							<button
								type="button"
								className="lens-disclosure"
								aria-expanded={advanced}
								onClick={() => setAdvanced((a) => !a)}
							>
								<ChevronRight aria-hidden="true" />
								{t("advanced")}
							</button>
							{advanced && (
								<>
									<p className="lib-hint">{t("advancedNote")}</p>
									<div className="lens-group mt-2">
										{(["memory", "embedding"] as const).map((role) => (
											<RolePicker
												key={role}
												forRole={role}
												value={overview.roles[role]}
												providers={connected}
												loadModels={loadModels}
												onChange={setRole(role)}
											/>
										))}
									</div>
								</>
							)}
						</section>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
