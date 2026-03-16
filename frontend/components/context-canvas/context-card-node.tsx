"use client";

import { memo, type ReactNode, useCallback, useRef, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { Ban, EyeOff, RotateCcw, Trash2 } from "lucide-react";
import type { ContextStatus } from "@/lib/canvas-types";
import type {
  MemoryConfidence,
  MemoryType,
  SessionContextMode,
} from "@/lib/memory-types";
import { cn } from "@/lib/utils";
import { useCanvasActions } from "./canvas-actions-context";

export interface ContextCardData {
  kind: "card";
  itemId: string;
  title: string;
  content: string;
  status: ContextStatus;
  sourceLabel: string;
  isMemory?: boolean;
  memoryType?: MemoryType;
  confidence?: MemoryConfidence;
  contextScope?: SessionContextMode;
  blockedInCurrentMode?: boolean;
  createdAt?: string;
}

const STATUS_STYLES: Record<ContextStatus, string> = {
  active: "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900",
  temporarily_ignored: "border-amber-300/60 bg-amber-50/50 opacity-60 dark:border-amber-800/60 dark:bg-amber-950/30",
  context_blocked: "border-sky-300/60 bg-sky-50/60 opacity-75 dark:border-sky-800/60 dark:bg-sky-950/30",
  trashed: "border-rose-300/60 bg-rose-50/50 opacity-40 dark:border-rose-800/60 dark:bg-rose-950/30",
};

function ContextCardNodeInner({ data }: NodeProps) {
  const d = data as unknown as ContextCardData;
  const { onStatusChange, onEditItem, currentMode } = useCanvasActions();

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(d.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleIgnore = useCallback(() => onStatusChange(d.itemId, "temporarily_ignored"), [onStatusChange, d.itemId]);
  const handleRestore = useCallback(() => onStatusChange(d.itemId, "active"), [onStatusChange, d.itemId]);
  const handleBlock = useCallback(() => onStatusChange(d.itemId, "context_blocked"), [onStatusChange, d.itemId]);
  const handleDelete = useCallback(() => onStatusChange(d.itemId, "trashed"), [onStatusChange, d.itemId]);

  const startEditing = useCallback(() => {
    if (d.status !== "active") return;
    setDraft(d.content);
    setIsEditing(true);
    // Focus after render
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [d.content, d.status]);

  const commitEdit = useCallback(() => {
    setIsEditing(false);
    if (draft !== d.content) {
      onEditItem(d.itemId, draft);
    }
  }, [draft, d.content, d.itemId, onEditItem]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setDraft(d.content);
  }, [d.content]);

  return (
    <div className={`group relative flex h-full w-full flex-col overflow-hidden rounded-xl border shadow-sm transition-all ${STATUS_STYLES[d.status]}`}>
      {/* Drag handle + actions */}
      <div className="drag-handle flex cursor-grab items-center justify-between px-3 py-2 active:cursor-grabbing">
        <h4 className="truncate text-xs font-semibold text-neutral-800 dark:text-neutral-200">{d.title}</h4>
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {d.isMemory && d.status === "active" && (
            <>
              <ActionBtn icon={<EyeOff className="h-3 w-3" />} title="Temporary Ignore" onClick={handleIgnore} />
              <ActionBtn icon={<Ban className="h-3 w-3" />} title={`Block in ${currentMode}`} onClick={handleBlock} />
              <ActionBtn icon={<Trash2 className="h-3 w-3" />} title="Move to Trash" onClick={handleDelete} variant="danger" />
            </>
          )}
          {d.isMemory && d.status === "temporarily_ignored" && (
            <ActionBtn
              icon={<RotateCcw className="h-3 w-3" />}
              title="Restore to Context"
              onClick={handleRestore}
            />
          )}
        </div>
      </div>

      {/* Content — double click to edit */}
      <div className="flex-1 overflow-hidden px-3 pb-2">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelEdit();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitEdit();
            }}
            className="h-full w-full resize-none rounded border border-blue-300 bg-blue-50/50 p-1 text-[11px] leading-relaxed text-neutral-700 outline-none dark:border-blue-700 dark:bg-blue-950/30 dark:text-neutral-300"
          />
        ) : (
          <p
            onDoubleClick={startEditing}
            className={`line-clamp-4 cursor-text text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400 ${
              d.status === "trashed" ? "line-through" : ""
            }`}
            title="Double click to edit"
          >
            {d.content}
          </p>
        )}
      </div>

      {/* Source label */}
      <div className="border-t border-neutral-100 px-3 py-1.5 dark:border-neutral-800">
        <div className="flex flex-wrap gap-1.5">
          {!d.isMemory && (
            <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
              {d.sourceLabel}
            </span>
          )}
          {d.isMemory && d.memoryType && <Pill>{d.memoryType}</Pill>}
          {d.isMemory && d.contextScope && <Pill>{d.contextScope}</Pill>}
          {d.blockedInCurrentMode && <Pill>blocked</Pill>}
        </div>
      </div>
    </div>
  );
}

export const ContextCardNode = memo(ContextCardNodeInner);

function ActionBtn({ icon, title, onClick, variant = "default" }: {
  icon: ReactNode; title: string; onClick: () => void; variant?: "default" | "danger";
}) {
  return (
    <button type="button" title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`rounded-md p-1 transition-colors ${variant === "danger" ? "text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/40" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
    >{icon}</button>
  );
}

function Pill({ children }: { children: ReactNode }) {
  const label = String(children);
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[9px] font-medium tracking-[0.01em]",
        getPillClasses(label),
      )}
    >
      {formatPillLabel(label)}
    </span>
  );
}

function formatPillLabel(label: string) {
  return label.replace(/\b\w/g, (char) => char.toUpperCase());
}

function getPillClasses(label: string) {
  const normalized = label.toLowerCase();

  if (
    normalized === "semantic" ||
    normalized === "episodic" ||
    normalized === "procedural"
  ) {
    return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300";
  }

  if (
    normalized === "study" ||
    normalized === "work" ||
    normalized === "personal" ||
    normalized === "life" ||
    normalized === "general"
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
  }

  if (normalized === "blocked") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  }

  return "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
}
