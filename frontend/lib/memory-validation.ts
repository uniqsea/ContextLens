import type { SessionContextMode } from "./memory-types";
export const CONTEXT_MODES = ["study", "work", "personal", "life", "general"] as const;
export function isContextMode(value: unknown): value is SessionContextMode {
  return typeof value === "string" && (CONTEXT_MODES as readonly string[]).includes(value);
}
