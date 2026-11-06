"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { MenuSelect } from "@/components/lens/menu-select";
import { Button } from "@/components/ui/button";
import {
	type ModelInfo,
	type ProviderRow,
	type Role,
	settingsApi,
	type TestResult,
} from "@/lib/model-settings";

/** "provider/model"; model ids may contain slashes themselves (e.g. OpenRouter). */
export function splitSpec(spec: string | null): [string, string] {
	if (!spec) return ["", ""];
	const cut = spec.indexOf("/");
	return [spec.slice(0, cut), spec.slice(cut + 1)];
}

/** Provider and model for one role, with a one-click real request to check them. */
export function RolePicker({
	forRole: role,
	value,
	providers,
	loadModels,
	onChange,
}: {
	forRole: Role;
	value: string | null;
	providers: ProviderRow[];
	loadModels: (provider: string) => Promise<ModelInfo[]>;
	onChange: (spec: string | null) => void;
}) {
	const t = useTranslations("settings");
	const kind: ModelInfo["kind"] = role === "embedding" ? "embedding" : "chat";
	const [provider, model] = splitSpec(value);
	const [options, setOptions] = useState<ModelInfo[]>([]);
	const [test, setTest] = useState<TestResult | "running" | null>(null);

	useEffect(() => {
		if (!provider) return setOptions([]);
		loadModels(provider).then((list) =>
			setOptions(list.filter((m) => m.kind === kind)),
		);
	}, [provider, kind, loadModels]);
	// A different choice makes the last test result meaningless.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the choice changes
	useEffect(() => setTest(null), [value]);

	const [missing, setMissing] = useState(false);
	const chooseProvider = async (next: string) => {
		setMissing(false);
		if (!next) return onChange(null);
		const first = (await loadModels(next)).find((m) => m.kind === kind);
		setMissing(!first);
		onChange(first ? `${next}/${first.id}` : null);
	};

	return (
		<div className="lens-role">
			<div>
				<h3>{t(`roles.${role}.name`)}</h3>
				<p>{t(`roles.${role}.desc`)}</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<MenuSelect
					label={t("pickProvider")}
					value={provider}
					placeholder={role === "memory" ? t("followAgent") : t("none")}
					options={[
						{
							value: "",
							label: role === "memory" ? t("followAgent") : t("none"),
						},
						...providers.map((p) => ({ value: p.id, label: p.name })),
					]}
					onChange={chooseProvider}
				/>
				{provider && (
					<MenuSelect
						label={t("pickModel")}
						value={model}
						options={options.map((m) => ({
							value: m.id,
							label: m.reasoning ? `${m.name} · ${t("reasoning")}` : m.name,
						}))}
						onChange={(next) => onChange(`${provider}/${next}`)}
					/>
				)}
				{value && (
					<Button
						type="button"
						variant="outline"
						disabled={test === "running"}
						onClick={async () => {
							setTest("running");
							setTest(await settingsApi.test(provider, model, kind));
						}}
					>
						{test === "running" ? t("testing") : t("test")}
					</Button>
				)}
				{missing && <small className="lens-warn">{t("noModelsOfKind")}</small>}
				{test && test !== "running" && (
					<small className={test.ok ? "lens-ok" : "lens-bad"}>
						{test.ok
							? t("testOk", { ms: test.latency_ms })
							: t("testFail", { error: test.error })}
					</small>
				)}
			</div>
		</div>
	);
}
