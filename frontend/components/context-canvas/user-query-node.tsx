"use client";

import { memo, useCallback, useRef, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { MessageSquare } from "lucide-react";
import { useCanvasActions } from "./canvas-actions-context";

export interface UserQueryData {
  kind: "userQuery";
  itemId: string;
  content: string;
}

function UserQueryNodeInner({ data }: NodeProps) {
  const d = data as unknown as UserQueryData;
  const { onEditItem } = useCanvasActions();

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(d.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEditing = useCallback(() => {
    setDraft(d.content);
    setIsEditing(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [d.content]);

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
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border-2 border-dashed border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-700/60 dark:bg-emerald-950/20">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <MessageSquare className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          User Query
        </span>
      </div>

      {/* Content — double click to edit */}
      <div className="flex-1 px-4 pb-3">
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
            className="h-full w-full resize-none rounded border border-emerald-300 bg-emerald-50/50 p-1 text-sm leading-relaxed text-neutral-800 outline-none dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-neutral-200"
          />
        ) : (
          <p
            onDoubleClick={startEditing}
            className="cursor-text text-sm leading-relaxed text-neutral-800 dark:text-neutral-200"
            title="Double click to edit"
          >
            {d.content}
          </p>
        )}
      </div>
    </div>
  );
}

export const UserQueryNode = memo(UserQueryNodeInner);
