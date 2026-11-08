import { loadField } from "./datasets";

// Local development only. The existing /api proxy also checks host and origin.
export async function GET(request: Request) {
	const source = new URL(request.url).searchParams.get("source");
	if (
		process.env.NODE_ENV !== "development" ||
		request.headers.get("x-memory-field") !== "inspect" ||
		(source !== "personal" && source !== "locomo")
	) {
		return new Response(null, { status: 404 });
	}
	try {
		return Response.json(await loadField(source), {
			headers: {
				"Content-Type": "application/json",
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch {
		return Response.json({ error: "本地数据未就绪" }, { status: 503 });
	}
}
