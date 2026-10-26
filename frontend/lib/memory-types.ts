export type MemoryType = "semantic" | "episodic" | "procedural";
export type MemoryConfidence = "high" | "low";
export type MemoryLifecycleState = "active" | "trashed";
export type SessionContextMode =
  | "study"
  | "work"
  | "personal"
  | "life"
  | "general";
export type MemoryEventType =
  | "temporary_ignore"
  | "context_block"
  | "trash"
  | "restore"
  | "context_unblock";

export interface MemoryRecord {
  revision: number;
  id: string;
  title: string;
  content: string;
  memory_type: MemoryType;
  confidence: MemoryConfidence;
  context_scope: SessionContextMode;
  created_at: string;
  updated_at: string;
  source_kind: string;
  lifecycle_state: MemoryLifecycleState;
  deleted_at: string | null;
  blocked_context_modes: SessionContextMode[];
}
