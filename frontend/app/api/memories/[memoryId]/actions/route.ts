import { NextRequest, NextResponse } from "next/server";

import {
  blockMemoryInContext,
  logTemporaryIgnore,
  restoreMemory,
  trashMemory,
} from "@/lib/memory-store";
import type { SessionContextMode } from "@/lib/memory-types";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ memoryId: string }> },
) {
  const { memoryId } = await params;
  const body = (await req.json()) as {
    action: "temporary_ignore" | "context_block" | "delete_forever" | "restore";
    contextMode?: SessionContextMode;
    threadId?: string;
  };

  if (body.action === "temporary_ignore") {
    logTemporaryIgnore(memoryId, body.threadId);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "context_block") {
    if (!body.contextMode) {
      return NextResponse.json(
        { error: "contextMode is required for context_block" },
        { status: 400 },
      );
    }
    return NextResponse.json({
      memory: blockMemoryInContext(memoryId, body.contextMode, body.threadId),
    });
  }

  if (body.action === "delete_forever") {
    return NextResponse.json({
      memory: trashMemory(memoryId, body.threadId),
    });
  }

  if (body.action === "restore") {
    return NextResponse.json({
      memory: restoreMemory(memoryId, body.threadId),
    });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
