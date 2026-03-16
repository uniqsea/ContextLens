import { NextRequest, NextResponse } from "next/server";

import { listMemories, listMemoriesForContext } from "@/lib/memory-store";
import type { SessionContextMode } from "@/lib/memory-types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") as SessionContextMode | null;
  const includeTrashed = req.nextUrl.searchParams.get("includeTrashed") === "true";
  const includeBlocked = req.nextUrl.searchParams.get("includeBlocked") === "true";

  const memories = mode
    ? listMemoriesForContext(mode, includeBlocked)
    : listMemories(includeTrashed);

  return NextResponse.json({ memories });
}
