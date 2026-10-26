"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLangGraphSendCommand } from "@assistant-ui/react-langgraph";
import {
  Check,
  Briefcase,
  ChevronDown,
  Plus,
  Search,
  GraduationCap,
  Heart,
  Layers3,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { ContextCanvas } from "@/components/context-canvas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CanvasState,
  ContextCanvasView,
  ContextGroup,
  ContextNoteLayout,
  ContextStatus,
} from "@/lib/canvas-types";
import {
  applyMemoryItemsToCanvas,
  memoryRecordToContextItem,
  mergeMemoryItems,
} from "@/lib/memory-view-model";
import type { MemoryRecord, SessionContextMode } from "@/lib/memory-types";

interface ContextPanelProps {
  state: CanvasState;
  isAwaitingApproval: boolean;
  onUpdateState: (patch: Partial<CanvasState>) => void;
  threadId: string | null;
}

const SESSION_MODES: SessionContextMode[] = [
  "study",
  "work",
  "personal",
  "life",
  "general",
];

const SESSION_MODE_META: Record<
  SessionContextMode,
  { label: string; icon: LucideIcon }
> = {
  study: { label: "Study", icon: GraduationCap },
  work: { label: "Work", icon: Briefcase },
  personal: { label: "Personal", icon: UserRound },
  life: { label: "Life", icon: Heart },
  general: { label: "General", icon: Layers3 },
};

type PendingMemoryAction =
  | {
      itemId: string;
      action: "context_blocked";
      title: string;
      description: string;
    }
  | {
      itemId: string;
      action: "trashed";
      title: string;
      description: string;
    };

export function ContextPanel({
  state,
  isAwaitingApproval,
  onUpdateState,
  threadId,
}: ContextPanelProps) {
  const sendCommand = useLangGraphSendCommand();
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [isMemoryPickerOpen, setIsMemoryPickerOpen] = useState(false);
  const [memoryPickerFilter, setMemoryPickerFilter] =
    useState<SessionContextMode | "all">("all");
  const [memoryPickerQuery, setMemoryPickerQuery] = useState("");
  const [pickerMemories, setPickerMemories] = useState<MemoryRecord[]>([]);
  const [pendingMemoryAction, setPendingMemoryAction] =
    useState<PendingMemoryAction | null>(null);
  const [isSubmittingMemoryAction, setIsSubmittingMemoryAction] = useState(false);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const memoryPickerRef = useRef<HTMLDivElement>(null);
  const manualMemoryIds = state.manual_memory_ids ?? [];

  useEffect(() => {
    if (!isModeMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!modeMenuRef.current?.contains(event.target as Node)) {
        setIsModeMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsModeMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isModeMenuOpen]);

  useEffect(() => {
    if (!isMemoryPickerOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!memoryPickerRef.current?.contains(event.target as Node)) {
        setIsMemoryPickerOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMemoryPickerOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isMemoryPickerOpen]);

  useEffect(() => {
    if (!isMemoryPickerOpen) return;

    const url =
      memoryPickerFilter === "all"
        ? "/api/memories?includeBlocked=true"
        : `/api/memories?mode=${memoryPickerFilter}&includeBlocked=true`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => setPickerMemories(data.memories ?? []))
      .catch(console.error);
  }, [isMemoryPickerOpen, memoryPickerFilter]);

  useEffect(() => {
    if (!isAwaitingApproval) {
      setIsSubmittingApproval(false);
    }
  }, [isAwaitingApproval]);

  const handleStatusChange = useCallback(
    async (itemId: string, newStatus: ContextStatus) => {
      const targetItem = state.context_items.find((item) => item.id === itemId);
      if (!targetItem) return;

      // Non-memory items that don't need policy tracking (system, retrieval, user).
      if (!targetItem.is_memory && targetItem.source_type !== "short_term") {
        onUpdateState({
          context_items: state.context_items.map((item) =>
            item.id === itemId ? { ...item, status: newStatus } : item,
          ),
        });
        return;
      }

      // Both persistent memories and short_term items use context_policies so the
      // backend _status() picks up temporarily_ignored on the next prepare_context.
      if (newStatus === "temporarily_ignored") {
        const nextItems = state.context_items.map((item) =>
          item.id === itemId ? { ...item, status: newStatus } : item,
        );
        const nextPolicies = [
          ...state.context_policies.filter((policy) => policy.item_id !== itemId),
          { item_id: itemId, status: "temporarily_ignored" as const },
        ];

        if (targetItem.is_memory) {
          void fetch(`/api/memories/${itemId}/actions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "temporary_ignore", threadId }),
          });
        }

        onUpdateState({ context_items: nextItems, context_policies: nextPolicies });
        return;
      }

      if (newStatus === "active" && targetItem.status === "temporarily_ignored") {
        onUpdateState({
          context_items: state.context_items.map((item) =>
            item.id === itemId ? { ...item, status: "active" as const } : item,
          ),
          context_policies: state.context_policies.filter(
            (policy) => policy.item_id !== itemId,
          ),
        });
        return;
      }

      if (newStatus === "context_blocked") {
        setPendingMemoryAction({
          itemId,
          action: "context_blocked",
          title: "Block this memory in this context?",
          description: `This memory will be blocked in ${SESSION_MODE_META[state.session_context_mode].label}. It will disappear from the current canvas and stay available in other contexts unless you block those too.`,
        });
        return;
      }

      if (newStatus === "trashed") {
        setPendingMemoryAction({
          itemId,
          action: "trashed",
          title: "Move this memory to trash?",
          description:
            "This memory will be removed from the current canvas and moved to Trash in Memory Library. You can restore it later from Trash.",
        });
      }
    },
    [state, onUpdateState, threadId],
  );

  const handleEditItem = useCallback(
    (itemId: string, newContent: string) => {
      if (state.context_items.find(item => item.id === itemId)?.is_memory) {
        window.alert("Edit persistent memory in Memory Library. The next confirmation will refresh this preview.");
        return;
      }
      const nextItems = state.context_items.map((item) =>
        item.id === itemId ? { ...item, content: newContent } : item,
      );
      onUpdateState({ context_items: nextItems });
    },
    [state.context_items, onUpdateState],
  );

  const handleLayoutChange = useCallback(
    (
      groups: ContextGroup[],
      layouts: ContextNoteLayout[],
      view: ContextCanvasView,
    ) => {
      onUpdateState({
        context_groups: groups,
        context_note_layouts: layouts,
        context_canvas_view: view,
      });
    },
    [onUpdateState],
  );

  const handleApprove = useCallback(async () => {
    if (isSubmittingApproval) return;

    setIsSubmittingApproval(true);
    onUpdateState({ awaiting_approval: false });

    try {
      await Promise.resolve(sendCommand({ resume: "approved" }));
    } catch (error) {
      console.error(error);
      onUpdateState({ awaiting_approval: true });
      setIsSubmittingApproval(false);
    }
  }, [isSubmittingApproval, onUpdateState, sendCommand]);

  const handleModeChange = useCallback(
    async (mode: SessionContextMode) => {
      const res = await fetch(`/api/memories?mode=${mode}`);
      const data = (await res.json()) as { memories?: MemoryRecord[] };
      const temporarilyIgnored = new Set(
        state.context_policies.map((policy) => policy.item_id),
      );
      const automaticMemoryItems = (data.memories ?? []).map((memory) => {
        const item = memoryRecordToContextItem(memory, mode);
        return temporarilyIgnored.has(item.id)
          ? { ...item, status: "temporarily_ignored" as const }
          : item;
      });
      const nextMemoryItems = automaticMemoryItems;

      onUpdateState({
        session_context_mode: mode,
        manual_memory_ids: [],
        ...applyMemoryItemsToCanvas(state, nextMemoryItems),
      });
      setIsModeMenuOpen(false);
    },
    [manualMemoryIds, onUpdateState, state],
  );

  const stats = useMemo(() => {
    let active = 0, activeTurns = 0, disabled = 0;
    for (const item of state.context_items) {
      if (item.layer === "memory") {
        item.status === "active" ? active++ : disabled++;
      } else if (item.layer === "short_term") {
        item.status === "active" ? activeTurns++ : disabled++;
      }
    }
    return { active, activeTurns, disabled };
  }, [state.context_items]);

  const isEmpty = state.context_items.length === 0;
  const currentModeMeta = SESSION_MODE_META[state.session_context_mode];
  const CurrentModeIcon = currentModeMeta.icon;
  const selectableMemories = useMemo(() => {
    const query = memoryPickerQuery.trim().toLowerCase();
    return pickerMemories.filter((memory) => {
      if (memory.lifecycle_state === "trashed") return false;
      if (!query) return true;
      return (
        memory.title.toLowerCase().includes(query) ||
        memory.content.toLowerCase().includes(query)
      );
    });
  }, [memoryPickerQuery, pickerMemories]);

  const handleOpenMemoryPicker = useCallback(() => {
    setMemoryPickerFilter("all");
    setMemoryPickerQuery("");
    setIsMemoryPickerOpen(true);
  }, []);

  const handleAddMemory = useCallback(
    (memory: MemoryRecord) => {
      if (memory.lifecycle_state === "trashed" || memory.blocked_context_modes.includes(state.session_context_mode)) {
        return;
      }

      const nextManualIds = Array.from(
        new Set([...manualMemoryIds, memory.id]),
      );
      const manualItem = memoryRecordToContextItem(
        memory,
        state.session_context_mode,
      );
      const automaticItems = state.context_items.filter(
        (item) => item.layer === "memory" && !manualMemoryIds.includes(item.id),
      );
      const nextMemoryItems = mergeMemoryItems(automaticItems, [
        ...state.context_items.filter(
          (item) =>
            item.layer === "memory" && manualMemoryIds.includes(item.id),
        ),
        manualItem,
      ]);

      onUpdateState({
        manual_memory_ids: nextManualIds,
        ...applyMemoryItemsToCanvas(state, nextMemoryItems),
      });
      setIsMemoryPickerOpen(false);
    },
    [manualMemoryIds, onUpdateState, state],
  );

  const removeMemoryFromCanvas = useCallback(
    (memoryId: string) => {
      const nextManualIds = manualMemoryIds.filter((id) => id !== memoryId);
      const nextMemoryItems = state.context_items.filter(
        (item) => item.layer === "memory" && item.id !== memoryId,
      );

      onUpdateState({
        manual_memory_ids: nextManualIds,
        context_policies: state.context_policies.filter(
          (policy) => policy.item_id !== memoryId,
        ),
        ...applyMemoryItemsToCanvas(state, nextMemoryItems),
      });
    },
    [manualMemoryIds, onUpdateState, state],
  );

  const handleConfirmMemoryAction = useCallback(async () => {
    if (!pendingMemoryAction || isSubmittingMemoryAction) return;

    setIsSubmittingMemoryAction(true);

    try {
      const body =
        pendingMemoryAction.action === "context_blocked"
          ? {
              action: "context_block" as const,
              contextMode: state.session_context_mode,
              threadId,
            }
          : {
              action: "trash" as const,
              threadId,
            };

      const res = await fetch(`/api/memories/${pendingMemoryAction.itemId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Memory action failed with status ${res.status}`);
      }

      removeMemoryFromCanvas(pendingMemoryAction.itemId);
      setPendingMemoryAction(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmittingMemoryAction(false);
    }
  }, [
    isSubmittingMemoryAction,
    pendingMemoryAction,
    removeMemoryFromCanvas,
    state.session_context_mode,
    threadId,
  ]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-neutral-50 dark:bg-neutral-950">
      {state.approval_notice && <p role="status" className="bg-amber-50 p-3 text-sm text-amber-900">{state.approval_notice}</p>}
      <details className="max-h-64 overflow-auto border-b bg-white p-3 text-xs">
        <summary>Selection evidence &amp; submitted request</summary>
        <p className="my-2">Changes require a fresh server preview before sending. Blocked memories must be unblocked in Memory Library.</p>
        {state.context_snapshot?.candidates.map(item => <p key={item.id} className="my-1"><b>{item.title}</b> {item.revision ? `v${item.revision}` : ""} · {item.status} · {item.selection_reason}</p>)}
        {state.last_request && <><h3 className="mt-3 font-semibold">Last submitted request · {state.last_request.mode}</h3><pre className="whitespace-pre-wrap break-words">{JSON.stringify(state.last_request.messages, null, 2)}</pre></>}
      </details>
      <div className="flex-1 min-h-0">
        {isEmpty ? (
          <EmptyState />
        ) : (
          <ContextCanvas
            state={state}
            onStatusChange={handleStatusChange}
            onEditItem={handleEditItem}
            onOpenMemoryPicker={handleOpenMemoryPicker}
            onLayoutChange={handleLayoutChange}
          />
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-4 py-3">
        <div className="pointer-events-auto relative" ref={modeMenuRef}>
          <button
            type="button"
            onClick={() => setIsModeMenuOpen((open) => !open)}
            className="flex items-center gap-2 rounded-[18px] border border-neutral-200 bg-white/95 px-3 py-2 text-sm font-medium text-neutral-700 shadow-[0_6px_16px_rgba(15,23,42,0.08)] transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              <CurrentModeIcon className="h-3 w-3" />
            </span>
            <span className="text-sm font-medium">{currentModeMeta.label}</span>
            <ChevronDown
              className={`h-3 w-3 text-neutral-400 transition-transform ${
                isModeMenuOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {isModeMenuOpen && (
            <div className="absolute left-0 top-full z-20 mt-2 w-60 overflow-hidden rounded-[22px] border border-white/60 bg-white/88 p-2 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur-2xl dark:border-white/10 dark:bg-neutral-900/88">
              <div className="py-1.5">
                {SESSION_MODES.map((mode) => {
                  const meta = SESSION_MODE_META[mode];
                  const Icon = meta.icon;

                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleModeChange(mode)}
                      className={`flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-1.5 text-left transition-colors ${
                        state.session_context_mode === mode
                          ? "bg-sky-50 text-neutral-900 dark:bg-sky-950/40 dark:text-neutral-100"
                          : "text-neutral-700 hover:bg-neutral-100/80 dark:text-neutral-200 dark:hover:bg-neutral-800/80"
                      }`}
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        <Icon className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 text-sm font-medium">
                        {meta.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <Link
          href="/memories"
          className="pointer-events-auto rounded-full border border-neutral-300 bg-white/95 px-4 py-2 text-sm font-medium text-neutral-700 shadow-[0_6px_16px_rgba(15,23,42,0.08)] transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          Memory Library
        </Link>
      </div>

      {isMemoryPickerOpen && (
        <div
          ref={memoryPickerRef}
          className="absolute left-[360px] top-14 z-30 w-[360px] overflow-hidden rounded-[24px] border border-white/70 bg-white/94 p-3 shadow-[0_24px_80px_rgba(15,23,42,0.18)] backdrop-blur-2xl dark:border-white/10 dark:bg-neutral-900/94"
        >
          <div className="flex items-center justify-between px-2 pb-3">
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Add Memory
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Select a memory from the library for this session.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsMemoryPickerOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <Plus className="h-3 w-3 rotate-45" />
            </button>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800/60">
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-neutral-400" />
              <input
                value={memoryPickerQuery}
                onChange={(event) => setMemoryPickerQuery(event.target.value)}
                placeholder="Filter memories"
                className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-400 dark:text-neutral-100"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(["all", ...SESSION_MODES] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setMemoryPickerFilter(mode)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  memoryPickerFilter === mode
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                    : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {mode === "all" ? "All" : SESSION_MODE_META[mode].label}
              </button>
            ))}
          </div>

          <div className="mt-3 max-h-[360px] overflow-y-auto">
            {selectableMemories.map((memory) => {
              const isAdded = manualMemoryIds.includes(memory.id);
              return (
                <button
                  key={memory.id}
                  type="button"
                  disabled={isAdded}
                  onClick={() => handleAddMemory(memory)}
                  className={`mb-2 flex w-full items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
                    isAdded
                      ? "cursor-not-allowed border-emerald-300 bg-emerald-50 text-emerald-900 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.08)] dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100"
                      : "border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className={`truncate text-sm font-medium ${
                          isAdded
                            ? "text-emerald-900 dark:text-emerald-100"
                            : "text-neutral-900 dark:text-neutral-100"
                        }`}
                      >
                        {memory.title}
                      </p>
                      {isAdded && (
                        <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200">
                          Added
                        </span>
                      )}
                    </div>
                    <p
                      className={`mt-1 line-clamp-2 text-xs leading-5 ${
                        isAdded
                          ? "text-emerald-800/80 dark:text-emerald-200/80"
                          : "text-neutral-500 dark:text-neutral-400"
                      }`}
                    >
                      {memory.content}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <TinyPill>{memory.memory_type}</TinyPill>
                      <TinyPill>{memory.context_scope}</TinyPill>
                    </div>
                  </div>
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                      isAdded
                        ? "border-emerald-300 bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/60"
                        : "border-neutral-200 dark:border-neutral-700"
                    }`}
                  >
                    {isAdded ? (
                      <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Plus className="h-3 w-3 text-neutral-500 dark:text-neutral-300" />
                    )}
                  </span>
                </button>
              );
            })}
            {selectableMemories.length === 0 && (
              <div className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                No matching memories.
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={pendingMemoryAction !== null}
        onOpenChange={(open) => {
          if (!open && !isSubmittingMemoryAction) {
            setPendingMemoryAction(null);
          }
        }}
      >
        <DialogContent className="max-w-md rounded-3xl border-neutral-200 p-6 dark:border-neutral-800">
          <DialogHeader>
            <DialogTitle>{pendingMemoryAction?.title}</DialogTitle>
            <DialogDescription>
              {pendingMemoryAction?.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingMemoryAction(null)}
              disabled={isSubmittingMemoryAction}
            >
              Cancel
            </Button>
            <Button
              variant={
                pendingMemoryAction?.action === "trashed"
                  ? "destructive"
                  : "default"
              }
              onClick={handleConfirmMemoryAction}
              disabled={isSubmittingMemoryAction}
            >
              {pendingMemoryAction?.action === "trashed"
                ? "Move to Trash"
                : "Block Memory"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isAwaitingApproval && !isSubmittingApproval && (
        <div className="border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {stats.active} memories · {stats.activeTurns} turns
              {stats.disabled > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {" "}
                  / {stats.disabled} modified
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={handleApprove}
              className="rounded-xl bg-neutral-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Review &amp; Confirm
            </button>
          </div>
        </div>
      )}

      {!isEmpty && !isAwaitingApproval && (
        <div className="pointer-events-none absolute left-4 top-20 rounded-xl border border-neutral-200 bg-white/90 px-3 py-2 text-xs text-neutral-500 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-400">
          Memory-aware context from the last turn
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-xs text-center">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          Context preview will appear here
        </p>
        <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          Send a message to see the memory-aware context layers the AI will use.
        </p>
      </div>
    </div>
  );
}

function TinyPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-neutral-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
      {children}
    </span>
  );
}
