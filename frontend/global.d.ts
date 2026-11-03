import type { Locale } from "./i18n/config";
import type messages from "./messages/zh.json";

// Message keys and locales are checked at compile time; zh.json is the source of truth.
declare module "next-intl" {
	interface AppConfig {
		Locale: Locale;
		Messages: typeof messages;
	}
}
