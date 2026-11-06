"use client";

import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleChevron,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Dialog,
	DialogBody,
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
	const connected = overview?.providers.filter((p) => p.connected) ?? [];
	const setRole = (role: Role) => (spec: string | null) =>
		run(() => settingsApi.setRoles({ [role]: spec }));

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{t("title")}</DialogTitle>
					<DialogDescription>{t("subtitle")}</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{error && (
						<Alert variant="destructive">
							{t("error", { message: error })}
						</Alert>
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
						<Collapsible render={<section />}>
							<CollapsibleTrigger
								render={
									<Button variant="quiet" size="sm" className="gap-1 pl-1" />
								}
							>
								<CollapsibleChevron />
								{t("advanced")}
							</CollapsibleTrigger>
							<CollapsibleContent>
								<p className="lib-hint">{t("advancedNote")}</p>
								<div className="mt-2 grid rounded-[18px] bg-panel p-1">
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
							</CollapsibleContent>
						</Collapsible>
					)}
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
