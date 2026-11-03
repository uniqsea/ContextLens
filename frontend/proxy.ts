import { type NextRequest, NextResponse } from "next/server";

/** The app only listens on this machine, so any other name is a site pointing its DNS here. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Compared with the Host header: nextUrl.origin says localhost however the page was opened. */
function sameHost(origin: string, host: string): boolean {
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}

/**
 * Every /api route acts on local data or the local agent, so only this app's own pages may call
 * them. Browsers mark cross-site requests; refuse those before any route runs.
 */
export function proxy(req: NextRequest) {
	const host = req.headers.get("host") ?? "";
	const site = req.headers.get("sec-fetch-site");
	const origin = req.headers.get("origin");
	const refused =
		!LOCAL_HOST.test(host) ||
		(site && site !== "same-origin" && site !== "none") ||
		(origin && !sameHost(origin, host));
	return refused
		? NextResponse.json({ error: "forbidden" }, { status: 403 })
		: NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
