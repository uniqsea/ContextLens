"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { setLocale } from "@/i18n/actions";
import { locales } from "@/i18n/config";

/** Saves the choice in a cookie, then re-renders the server tree in the new language. */
export function LocaleSwitch({ className }: { className?: string }) {
	const t = useTranslations("locale");
	const current = useLocale();
	const router = useRouter();
	const [pending, start] = useTransition();
	return (
		// biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form section
		<div
			className={className}
			role="group"
			aria-label={t("label")}
			aria-busy={pending}
		>
			{locales.map((l) => (
				<button
					key={l}
					type="button"
					lang={l === "zh" ? "zh-CN" : "en"}
					aria-pressed={current === l}
					disabled={pending}
					onClick={() => {
						if (l === current) return;
						start(async () => {
							await setLocale(l);
							router.refresh();
						});
					}}
				>
					{t(l)}
				</button>
			))}
		</div>
	);
}
