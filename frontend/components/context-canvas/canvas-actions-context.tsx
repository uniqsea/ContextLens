"use client";

import { createContext, useContext } from "react";
import type { ContextStatus } from "@/lib/canvas-types";
import type { SessionContextMode } from "@/lib/memory-types";

interface CanvasActions {
  onStatusChange: (itemId: string, status: ContextStatus) => void;
  onEditItem: (itemId: string, newContent: string) => void;
  onOpenMemoryPicker: () => void;
  currentMode: SessionContextMode;
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null);

export function useCanvasActions(): CanvasActions {
  const ctx = useContext(CanvasActionsContext);
  if (!ctx) throw new Error("useCanvasActions must be inside ContextCanvas");
  return ctx;
}
