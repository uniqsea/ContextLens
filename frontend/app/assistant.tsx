"use client";

import { useCallback, useRef, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { Client } from "@langchain/langgraph-sdk";

import { createThread, getThreadState, sendMessage } from "@/lib/chatApi";
import { Thread } from "@/components/assistant-ui/thread";
import { ConversationLayout } from "@/components/conversation-layout";
import { ContextPanel } from "@/components/context-panel";
import { EMPTY_CANVAS_STATE, type CanvasState } from "@/lib/canvas-types";

// ---------------------------------------------------------------------------
// LangGraph client for direct thread state writes (canvas edits)
// ---------------------------------------------------------------------------

const lgClient = new Client({
  apiUrl:
    process.env.NEXT_PUBLIC_LANGGRAPH_API_URL ||
    new URL("/api", typeof window !== "undefined" ? window.location.href : "http://localhost:3000").href,
});

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export function Assistant() {
  const [canvasState, setCanvasState] = useState<CanvasState>(EMPTY_CANVAS_STATE);
  const [isAwaitingApproval, setIsAwaitingApproval] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const threadIdRef = useRef<string | null>(null);

  // -----------------------------------------------------------------------
  // LangGraph runtime (chat messaging + stream interception)
  // -----------------------------------------------------------------------

  const runtime = useLangGraphRuntime({
    stream: async function* (messages, { initialize, command }) {
      const { externalId } = await initialize();
      if (!externalId) throw new Error("Thread not initialized");
      threadIdRef.current = externalId;
      setThreadId(externalId);

      // If this is a resume call, first write canvas edits to thread state
      if (command?.resume) {
        // Check if user query was edited on the canvas
        const userQueryItem = canvasState.context_items.find(
          (item) => item.layer === "user",
        );

        // Get the current thread state to find the original user message
        const currentState = await getThreadState(externalId);
        const currentMessages = (
          currentState.values as { messages?: Array<{ id: string; type: string; content: string }> }
        ).messages;
        const lastUserMsg = currentMessages
          ?.slice()
          .reverse()
          .find((m) => m.type === "human");

        const values: Record<string, unknown> = {
          context_items: canvasState.context_items,
          context_policies: canvasState.context_policies,
          awaiting_approval: false,
          session_context_mode: canvasState.session_context_mode,
          manual_memory_ids: canvasState.manual_memory_ids,
        };

        // If user query was edited, also update the message (same ID → replace)
        if (
          userQueryItem &&
          lastUserMsg &&
          userQueryItem.content !== lastUserMsg.content
        ) {
          values.messages = [
            {
              type: "human",
              content: userQueryItem.content,
              id: lastUserMsg.id,
            },
          ];
        }

        await lgClient.threads.updateState(externalId, { values });
      }

      setIsAwaitingApproval(false);

      const generator = await sendMessage({
        threadId: externalId,
        messages,
        command,
      });

      // Intercept stream chunks — extract canvas state from "updates" events
      for await (const chunk of generator) {
        if (chunk.event === "updates" && chunk.data) {
          extractCanvasUpdates(chunk.data as Record<string, unknown>);
        }
        yield chunk;
      }

      // After stream ends, check if the graph hit interrupt()
      try {
        const threadState = await getThreadState(externalId);
        if (threadState.next && threadState.next.length > 0) {
          // Graph is paused at await_approval node — sync full state
          const values = threadState.values as Record<string, unknown>;
          if (values?.context_items) {
            setCanvasState((prev) => mergeCanvasState(prev, values));
          }
          setIsAwaitingApproval(true);
        }
      } catch {
        // getThreadState may fail if thread was just created; ignore
      }
    },

    create: async () => {
      const { thread_id } = await createThread();
      threadIdRef.current = thread_id;
      setThreadId(thread_id);
      return { externalId: thread_id };
    },

    load: async (externalId) => {
      setThreadId(externalId);
      const state = await getThreadState(externalId);
      const values = state.values as Record<string, unknown>;
      if (values?.context_items) {
        setCanvasState((prev) => mergeCanvasState(prev, values));
      }
      return { messages: state.values?.messages ?? [] };
    },
  });

  // -----------------------------------------------------------------------
  // Canvas state handlers
  // -----------------------------------------------------------------------

  /** Write canvas edits (status changes, drag positions) to local + thread */
  const handleUpdateState = useCallback(
    (patch: Partial<CanvasState>) => {
      setCanvasState((prev) => ({ ...prev, ...patch }));

      // Fire-and-forget write to LangGraph thread state
      if (threadIdRef.current) {
        lgClient.threads
          .updateState(threadIdRef.current, { values: patch })
          .catch(console.error);
      }
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Extract canvas-related fields from stream "updates" events */
  function extractCanvasUpdates(data: Record<string, unknown>) {
    for (const nodeUpdate of Object.values(data)) {
      if (!nodeUpdate || typeof nodeUpdate !== "object") continue;
      const update = nodeUpdate as Record<string, unknown>;
      if (update.context_items) {
        setCanvasState((prev) => mergeCanvasState(prev, update));
      }
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ConversationLayout
        chatContent={<Thread />}
        inspectorContent={
          <ContextPanel
            state={canvasState}
            isAwaitingApproval={isAwaitingApproval}
            onUpdateState={handleUpdateState}
            threadId={threadId}
          />
        }
      />
    </AssistantRuntimeProvider>
  );
}

// ---------------------------------------------------------------------------
// Pure helper — merge partial agent state into CanvasState
// ---------------------------------------------------------------------------

function mergeCanvasState(
  prev: CanvasState,
  values: Record<string, unknown>,
): CanvasState {
  return {
    context_items:
      (values.context_items as CanvasState["context_items"]) ??
      prev.context_items,
    context_groups:
      (values.context_groups as CanvasState["context_groups"]) ??
      prev.context_groups,
    context_note_layouts:
      (values.context_note_layouts as CanvasState["context_note_layouts"]) ??
      prev.context_note_layouts,
    context_canvas_view:
      (values.context_canvas_view as CanvasState["context_canvas_view"]) ??
      prev.context_canvas_view,
    prompt_layers:
      (values.prompt_layers as CanvasState["prompt_layers"]) ??
      prev.prompt_layers,
    context_policies:
      (values.context_policies as CanvasState["context_policies"]) ??
      prev.context_policies,
    session_context_mode:
      (values.session_context_mode as CanvasState["session_context_mode"]) ??
      prev.session_context_mode,
    manual_memory_ids:
      (values.manual_memory_ids as CanvasState["manual_memory_ids"]) ??
      prev.manual_memory_ids,
    awaiting_approval:
      (values.awaiting_approval as boolean) ?? prev.awaiting_approval,
  };
}
