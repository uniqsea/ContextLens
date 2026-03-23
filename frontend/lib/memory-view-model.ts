import type {
  CanvasState,
  ContextGroup,
  ContextItem,
  ContextNoteLayout,
  PromptLayer,
} from "@/lib/canvas-types";
import type { MemoryRecord, SessionContextMode } from "@/lib/memory-types";

const GROUP_MIN_HEIGHT = 200;
const CARD_HEIGHT = 140;
const CARD_GAP = 16;
const CARD_OFFSET_TOP = 50;
const CARD_OFFSET_LEFT = 30;

export function memoryRecordToContextItem(
  record: MemoryRecord,
  currentMode: SessionContextMode,
): ContextItem {
  return {
    id: record.id,
    layer: "memory",
    title: record.title,
    content: record.content,
    source_label: "Memory",
    source_type: "memory",
    created_at: record.created_at,
    status: record.lifecycle_state === "trashed" ? "trashed" : "active",
    is_memory: true,
    memory_type: record.memory_type,
    memory_confidence: record.confidence,
    context_scope: record.context_scope,
    blocked_context_modes: record.blocked_context_modes,
    blocked_in_current_mode: record.blocked_context_modes.includes(currentMode),
    memory_lifecycle_state: record.lifecycle_state,
  };
}

export function buildPromptLayers(items: ContextItem[]): PromptLayer[] {
  const orderedLayers = ["system", "short_term", "memory", "retrieval", "user"] as const;
  return orderedLayers.flatMap((layer) => {
    const itemIds = items
      .filter((item) => item.layer === layer)
      .map((item) => item.id);
    return itemIds.length > 0 ? [{ layer, item_ids: itemIds }] : [];
  });
}

export function applyMemoryItemsToCanvas(
  state: CanvasState,
  nextMemoryItems: ContextItem[],
): Partial<CanvasState> {
  const nonMemoryItems = state.context_items.filter((item) => item.layer !== "memory");
  const nextItems = [...nonMemoryItems, ...nextMemoryItems];
  const nextLayouts = rebuildMemoryLayouts(state.context_note_layouts, nextMemoryItems);
  const nextGroups = rebuildMemoryGroup(state.context_groups, nextMemoryItems.length);

  return {
    context_items: nextItems,
    context_note_layouts: nextLayouts,
    context_groups: nextGroups,
    prompt_layers: buildPromptLayers(nextItems),
  };
}

export function mergeMemoryItems(
  automaticMemoryItems: ContextItem[],
  manualMemoryItems: ContextItem[],
): ContextItem[] {
  const byId = new Map<string, ContextItem>();
  for (const item of automaticMemoryItems) {
    byId.set(item.id, item);
  }
  for (const item of manualMemoryItems) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

function rebuildMemoryLayouts(
  currentLayouts: ContextNoteLayout[],
  nextMemoryItems: ContextItem[],
): ContextNoteLayout[] {
  const nonMemoryLayouts = currentLayouts.filter((layout) => layout.group_id !== "group-memory");
  const memoryLayouts = nextMemoryItems.map((item, index) => ({
    item_id: item.id,
    group_id: "group-memory",
    x: CARD_OFFSET_LEFT,
    y: CARD_OFFSET_TOP + index * (CARD_HEIGHT + CARD_GAP),
  }));
  return [...nonMemoryLayouts, ...memoryLayouts];
}

function rebuildMemoryGroup(
  currentGroups: ContextGroup[],
  memoryCount: number,
): ContextGroup[] {
  const height =
    memoryCount === 0
      ? GROUP_MIN_HEIGHT
      : CARD_OFFSET_TOP + memoryCount * (CARD_HEIGHT + CARD_GAP) + CARD_GAP;

  return currentGroups.map((group) =>
    group.id === "group-memory" ? { ...group, height } : group,
  );
}
