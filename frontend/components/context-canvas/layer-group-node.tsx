"use client";

import { memo } from "react";
import { type NodeProps, NodeResizer } from "@xyflow/react";
import { Brain, Clock, Cpu, MessageSquare, Plus, Search } from "lucide-react";
import type { ContextLayer } from "@/lib/canvas-types";
import { useCanvasActions } from "./canvas-actions-context";

// ---------------------------------------------------------------------------
// Node data shape
// ---------------------------------------------------------------------------

export interface LayerGroupData {
  kind: "group";
  groupId: string;
  layer: ContextLayer;
  title: string;
}

// ---------------------------------------------------------------------------
// Layer → visual config
// ---------------------------------------------------------------------------

const LAYER_ICON: Record<ContextLayer, React.ReactNode> = {
  system: <Cpu className="h-3.5 w-3.5" />,
  memory: <Brain className="h-3.5 w-3.5" />,
  retrieval: <Search className="h-3.5 w-3.5" />,
  user: <MessageSquare className="h-3.5 w-3.5" />,
  short_term: <Clock className="h-3.5 w-3.5" />,
};

const LAYER_BORDER: Record<ContextLayer, string> = {
  system: "border-neutral-300 dark:border-neutral-600",
  memory: "border-amber-300/60 dark:border-amber-700/60",
  retrieval: "border-blue-300/60 dark:border-blue-700/60",
  user: "border-emerald-300/60 dark:border-emerald-700/60",
  short_term: "border-violet-300/60 dark:border-violet-700/60",
};

const LAYER_BG: Record<ContextLayer, string> = {
  system: "bg-neutral-50/80 dark:bg-neutral-900/60",
  memory: "bg-amber-50/40 dark:bg-amber-950/20",
  retrieval: "bg-blue-50/40 dark:bg-blue-950/20",
  user: "bg-emerald-50/40 dark:bg-emerald-950/20",
  short_term: "bg-violet-50/40 dark:bg-violet-950/20",
};

const LAYER_TEXT: Record<ContextLayer, string> = {
  system: "text-neutral-500 dark:text-neutral-400",
  memory: "text-amber-600 dark:text-amber-400",
  retrieval: "text-blue-600 dark:text-blue-400",
  user: "text-emerald-600 dark:text-emerald-400",
  short_term: "text-violet-600 dark:text-violet-400",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function LayerGroupNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as LayerGroupData;
  const { onOpenMemoryPicker } = useCanvasActions();

  return (
    <>
      <NodeResizer
        minWidth={280}
        minHeight={200}
        isVisible={selected}
        lineClassName="!border-neutral-300 dark:!border-neutral-600"
        handleClassName="!h-2.5 !w-2.5 !rounded-sm !border-neutral-400 !bg-white dark:!border-neutral-500 dark:!bg-neutral-800"
      />

      <div
        className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border-2 border-dashed ${LAYER_BORDER[d.layer]} ${LAYER_BG[d.layer]}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={LAYER_TEXT[d.layer]}>{LAYER_ICON[d.layer]}</span>
            <span
              className={`text-xs font-semibold uppercase tracking-wide ${LAYER_TEXT[d.layer]}`}
            >
              {d.title}
            </span>
          </div>
          {d.layer === "memory" && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenMemoryPicker();
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-amber-300/70 bg-white/90 text-amber-600 transition-colors hover:bg-amber-50 dark:border-amber-700/70 dark:bg-neutral-900 dark:text-amber-400 dark:hover:bg-amber-950/20"
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export const LayerGroupNode = memo(LayerGroupNodeInner);
