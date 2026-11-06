import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Proxy to the local agent server (same-origin is enforced in proxy.ts). The browser never talks
 * to the agent directly, so the agent can refuse cross-origin requests outright. Only the routes
 * the UI uses pass.
 */
const ALLOWED = /^(threads|runs|assistants|lens)(\/|$)/;
// fetch() already decoded the body; these would describe the original bytes.
const DROPPED_HEADERS = [
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
];

async function forward(req: NextRequest): Promise<Response> {
	const path = req.nextUrl.pathname.replace(/^\/api\//, "");
	if (!ALLOWED.test(path)) {
		return NextResponse.json({ error: "forbidden" }, { status: 403 });
	}
	const target = new URL(`${process.env.LANGGRAPH_API_URL}/${path}`);
	target.search = req.nextUrl.search;
	const hasBody = !["GET", "HEAD"].includes(req.method);
	const upstream = await fetch(target, {
		method: req.method,
		...(path === "lens/chat-presence" && {
			signal: req.signal,
			cache: "no-store",
		}),
		headers: hasBody ? { "Content-Type": "application/json" } : undefined,
		body: hasBody ? await req.text() : undefined,
	});
	const headers = new Headers(upstream.headers);
	for (const name of DROPPED_HEADERS) headers.delete(name);
	return new Response(upstream.body, { status: upstream.status, headers });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
