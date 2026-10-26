import { NextRequest, NextResponse } from "next/server";

import {
  unblockMemoryInContext,
  blockMemoryInContext,
  logTemporaryIgnore,
  restoreMemory,
  trashMemory,
} from "@/lib/memory-store";
import type { SessionContextMode } from "@/lib/memory-types";

import { isContextMode } from "@/lib/memory-validation";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ memoryId: string }> },
) {
  const { memoryId } = await params;
  const body = (await req.json()) as {
    action: "temporary_ignore" | "context_block" | "trash" | "restore" | "context_unblock";
    contextMode?: SessionContextMode;
    threadId?: string;
  };

  if ((body.action === "context_block" || body.action === "context_unblock") && !isContextMode(body.contextMode)) {
    return NextResponse.json({error: "Valid context required"}, {status: 400});
  }
  if (body.action === "context_unblock" && body.contextMode) {
    return NextResponse.json({memory: unblockMemoryInContext(memoryId, body.contextMode)});
  }
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

  if (body.action === "trash") {
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
