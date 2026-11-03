"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "./config";

export async function setLocale(locale: string) {
	if (!isLocale(locale)) return;
	(await cookies()).set(LOCALE_COOKIE, locale, {
		path: "/",
		maxAge: 60 * 60 * 24 * 365,
		sameSite: "lax",
	});
	// Memories written in the interface language follow it; the agent rewrites them if so.
	await fetch(
		`${process.env.LANGGRAPH_API_URL}/lens/settings/memory-language`,
		{
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ interface: locale }),
		},
	).catch(() => undefined);
}
