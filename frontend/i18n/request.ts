import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { isLocale, LOCALE_COOKIE, negotiate } from "./config";

// No locale in the URL: this is an app, not indexed content. An explicit choice
// (cookie) wins, then the browser's languages, then the default.
export default getRequestConfig(async () => {
	const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
	const locale = isLocale(saved)
		? saved
		: negotiate((await headers()).get("accept-language"));
	return {
		locale,
		messages: (await import(`../messages/${locale}.json`)).default,
	};
});
