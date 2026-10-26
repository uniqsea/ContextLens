import { NextRequest, NextResponse } from "next/server";

import { saveMemory, listMemories, listMemoriesForContext } from "@/lib/memory-store";
import type { SessionContextMode } from "@/lib/memory-types";

import { isContextMode } from "@/lib/memory-validation";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") as SessionContextMode | null;
  if (mode && !isContextMode(mode)) return NextResponse.json({error: "Invalid context"}, {status: 400});
  const includeTrashed = req.nextUrl.searchParams.get("includeTrashed") === "true";
  const includeBlocked = req.nextUrl.searchParams.get("includeBlocked") === "true";

  const memories = mode
    ? listMemoriesForContext(mode, includeBlocked)
    : listMemories(includeTrashed);

  return NextResponse.json({ memories });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!isContextMode(body.context_scope) || typeof body.title !== "string" || !body.title.trim() ||
        typeof body.content !== "string" || !body.content.trim() || body.content.length > 20000 ||
        typeof body.source_kind !== "string" || !body.source_kind.trim() ||
        (body.id !== undefined && (typeof body.id !== "string" || !Number.isInteger(body.revision)))) {
      return NextResponse.json({error: "Valid title, content, source and context are required"}, {status: 400});
    }
    return NextResponse.json({memory: saveMemory(body)});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "Save failed"}, {status: 409});
  }
}
