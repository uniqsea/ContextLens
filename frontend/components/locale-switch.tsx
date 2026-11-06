"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { setLocale } from "@/i18n/actions";
import { locales } from "@/i18n/config";

/** Saves the choice in a cookie, then re-renders the server tree in the new language. */
export function LocaleSwitch({ className }: { className?: string }) {
	const t = useTranslations("locale");
	const current = useLocale();
	const router = useRouter();
	const [pending, start] = useTransition();
	return (
		<ToggleGroup
			variant="segment"
			spacing={0.5}
			className={className}
			aria-label={t("label")}
			aria-busy={pending}
			disabled={pending}
			value={[current]}
			onValueChange={(next) => {
				const l = next[0];
				if (!l || l === current) return;
				start(async () => {
					await setLocale(l);
					router.refresh();
				});
			}}
		>
			{locales.map((l) => (
				<ToggleGroupItem key={l} value={l} lang={l === "zh" ? "zh-CN" : "en"}>
					{t(l)}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
