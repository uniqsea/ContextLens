export const locales = ["zh", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "zh";
/** The cookie next-intl's own routing would use, so adding routing later keeps the choice. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const isLocale = (v: unknown): v is Locale =>
	locales.includes(v as Locale);

/** BCP 47 tag for <html lang> and Intl formatting. */
export const htmlLang = (locale: Locale) => (locale === "zh" ? "zh-CN" : "en");

/** Best match from an Accept-Language header, honouring q-values. */
export function negotiate(header: string | null): Locale {
	const ranked = (header ?? "")
		.split(",")
		.map((part) => {
			const [tag, q] = part.trim().split(";q=");
			return { tag: tag.toLowerCase(), q: q === undefined ? 1 : Number(q) };
		})
		.filter((r) => r.tag && r.q > 0)
		.sort((a, b) => b.q - a.q);
	for (const { tag } of ranked) {
		const base = tag.split("-")[0];
		if (isLocale(base)) return base;
	}
	return defaultLocale;
}
