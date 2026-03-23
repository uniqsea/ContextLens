import type {
  MemoryConfidence,
  MemoryLifecycleState,
  MemoryType,
  SessionContextMode,
} from "@/lib/memory-types";

export type ContextLayer = "system" | "memory" | "retrieval" | "user" | "short_term";
export type ContextStatus =
  | "active"
  | "temporarily_ignored"
  | "context_blocked"
  | "trashed";
export type ThreadPolicyStatus = "temporarily_ignored";

export interface ContextItem {
  id: string;
  layer: ContextLayer;
  title: string;
  content: string;
  source_label: string;
  source_type: string;
  created_at: string;
  status: ContextStatus;
  is_memory: boolean;
  memory_type?: MemoryType;
  memory_confidence?: MemoryConfidence;
  context_scope?: SessionContextMode;
  blocked_context_modes?: SessionContextMode[];
  blocked_in_current_mode?: boolean;
  memory_lifecycle_state?: MemoryLifecycleState;
}

export interface ContextGroup {
  id: string;
  layer: ContextLayer;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContextNoteLayout {
  item_id: string;
  group_id: string;
  x: number;
  y: number;
}

export interface ContextCanvasView {
  x: number;
  y: number;
  z: number;
}

export interface PromptLayer {
  layer: ContextLayer;
  item_ids: string[];
}

export interface ContextPolicy {
  item_id: string;
  status: ThreadPolicyStatus;
}

export interface CanvasState {
  context_items: ContextItem[];
  context_groups: ContextGroup[];
  context_note_layouts: ContextNoteLayout[];
  context_canvas_view: ContextCanvasView;
  prompt_layers: PromptLayer[];
  context_policies: ContextPolicy[];
  awaiting_approval: boolean;
  session_context_mode: SessionContextMode;
  manual_memory_ids: string[];
}

export const EMPTY_CANVAS_STATE: CanvasState = {
  context_items: [],
  context_groups: [],
  context_note_layouts: [],
  context_canvas_view: { x: 0, y: 0, z: 0.85 },
  prompt_layers: [],
  context_policies: [],
  awaiting_approval: false,
  session_context_mode: "general",
  manual_memory_ids: [],
};

export const LAYER_CONFIG: Record<
  ContextLayer,
  { label: string; color: string; icon: string }
> = {
  system: { label: "System", color: "#6b7280", icon: "Cpu" },
  memory: { label: "Memory", color: "#d97706", icon: "Brain" },
  retrieval: { label: "Retrieval", color: "#2563eb", icon: "Search" },
  user: { label: "User Query", color: "#059669", icon: "MessageSquare" },
  short_term: { label: "Short-term", color: "#7c3aed", icon: "Clock" },
};
