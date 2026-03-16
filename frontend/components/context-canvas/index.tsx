"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  Controls,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";

import type {
  CanvasState,
  ContextCanvasView,
  ContextGroup,
  ContextItem,
  ContextLayer,
  ContextNoteLayout,
  ContextStatus,
} from "@/lib/canvas-types";
import { CanvasActionsContext } from "./canvas-actions-context";
import { ContextCardNode } from "./context-card-node";
import { LayerGroupNode } from "./layer-group-node";
import { UserQueryNode } from "./user-query-node";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ContextCanvasProps {
  state: CanvasState;
  onStatusChange: (itemId: string, status: ContextStatus) => void;
  onEditItem: (itemId: string, newContent: string) => void;
  onOpenMemoryPicker: () => void;
  onLayoutChange: (
    groups: ContextGroup[],
    layouts: ContextNoteLayout[],
    view: ContextCanvasView,
  ) => void;
}

// Stable node type registry — must not be recreated on render
const NODE_TYPES = {
  layerGroup: LayerGroupNode,
  contextCard: ContextCardNode,
  userQuery: UserQueryNode,
};

// ---------------------------------------------------------------------------
// Build nodes — no callbacks in data, so nodes are stable between renders
// ---------------------------------------------------------------------------

function buildNodes(
  groups: ContextGroup[],
  items: ContextItem[],
  layouts: ContextNoteLayout[],
  currentMode: CanvasState["session_context_mode"],
): Node[] {
  const groupNodes: Node[] = groups.map((g) => ({
    id: getRenderGroupId(g.id, g.layer, currentMode),
    type: "layerGroup",
    position: { x: g.x, y: g.y },
    draggable: true,
    selectable: true,
    style: { width: g.width, height: g.height },
    data: { kind: "group", groupId: g.id, layer: g.layer, title: g.title },
  }));

  const layoutMap = new Map(layouts.map((l) => [l.item_id, l]));

  const cardNodes: Node[] = [];
  const userQueryNodes: Node[] = [];

  for (const item of items) {
    const layout = layoutMap.get(item.id);
    if (!layout) continue;

    // User query: standalone flat node (no parent group)
    if (layout.group_id === "user-flat") {
      userQueryNodes.push({
        id: getRenderItemId(item, currentMode),
        type: "userQuery",
        position: { x: layout.x, y: layout.y },
        draggable: true,
        selectable: false,
        style: { width: 300, height: 160 },
        data: {
          kind: "userQuery",
          itemId: item.id,
          content: item.content,
        },
      });
      continue;
    }

    // Normal context card inside a group
    cardNodes.push({
      id: getRenderItemId(item, currentMode),
      type: "contextCard",
      parentId: getRenderGroupId(layout.group_id, item.layer, currentMode),
      extent: "parent" as const,
      expandParent: false,
      draggable: true,
      selectable: false,
      dragHandle: ".drag-handle",
      position: { x: layout.x, y: layout.y },
      style: { width: 260, height: 140 },
      data: {
        kind: "card",
        itemId: item.id,
        title: item.title,
        content: item.content,
        status: item.status,
        sourceLabel: item.source_label,
        isMemory: item.is_memory,
        memoryType: item.memory_type,
        confidence: item.memory_confidence,
        contextScope: item.context_scope,
        blockedInCurrentMode: item.blocked_in_current_mode,
        createdAt: item.created_at,
      },
    });
  }

  return [...groupNodes, ...cardNodes, ...userQueryNodes];
}

// ---------------------------------------------------------------------------
// Inner component (inside ReactFlowProvider, has access to useReactFlow)
// ---------------------------------------------------------------------------

function CanvasInner({ state, onStatusChange, onEditItem, onOpenMemoryPicker, onLayoutChange }: ContextCanvasProps) {
  const { context_items: items, context_groups: groups, context_note_layouts: layouts, context_canvas_view: view } = state;
  const { setViewport } = useReactFlow();

  // Sync external view changes (e.g. after state load) without controlling viewport
  const prevViewRef = useRef<ContextCanvasView | null>(null);
  useEffect(() => {
    const prevView = prevViewRef.current;
    const hasChanged =
      !prevView ||
      prevView.x !== view.x ||
      prevView.y !== view.y ||
      prevView.z !== view.z;

    if (!hasChanged) return;

    prevViewRef.current = view;

    const frame = requestAnimationFrame(() => {
      void setViewport({ x: view.x, y: view.y, zoom: view.z });
    });

    return () => cancelAnimationFrame(frame);
  }, [view, setViewport]);

  const nodes = useMemo(
    () => buildNodes(groups, items, layouts, state.session_context_mode),
    [groups, items, layouts, state.session_context_mode],
  );

  const defaultViewport = useMemo<Viewport>(
    () => ({ x: view.x, y: view.y, zoom: view.z }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // only for initial render
  );

  const handleMoveEnd = useCallback(
    (_: unknown, vp: Viewport) => {
      onLayoutChange(groups, layouts, { x: vp.x, y: vp.y, z: vp.zoom });
    },
    [groups, layouts, onLayoutChange],
  );

  const handleNodeDragStop = useCallback(
    (_: unknown, draggedNode: Node) => {
      const draggedGroupId = (draggedNode.data as { groupId?: string } | undefined)?.groupId;
      const draggedItemId = (draggedNode.data as { itemId?: string } | undefined)?.itemId;
      const isGroup = groups.some((g) => g.id === draggedGroupId);
      if (isGroup) {
        const nextGroups = groups.map((g) =>
          g.id === draggedGroupId
            ? { ...g, x: draggedNode.position.x, y: draggedNode.position.y }
            : g,
        );
        onLayoutChange(nextGroups, layouts, view);
        return;
      }
      const nextLayouts = layouts.map((l) =>
        l.item_id === draggedItemId
          ? { ...l, x: draggedNode.position.x, y: draggedNode.position.y }
          : l,
      );
      onLayoutChange(groups, nextLayouts, view);
    },
    [groups, layouts, view, onLayoutChange],
  );

  return (
    <CanvasActionsContext.Provider
      value={{
        onStatusChange,
        onEditItem,
        onOpenMemoryPicker,
        currentMode: state.session_context_mode,
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={NODE_TYPES}
        defaultViewport={defaultViewport}
        onMoveEnd={handleMoveEnd}
        onNodeDragStop={handleNodeDragStop}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        preventScrolling={false}
        minZoom={0.2}
        maxZoom={1.5}
        fitView={false}
        proOptions={{ hideAttribution: true }}
        className="bg-[radial-gradient(circle_at_center,_rgba(0,0,0,0.04)_1px,_transparent_1px)] [background-size:24px_24px] dark:bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.05)_1px,_transparent_1px)]"
      >
        <Background gap={24} size={1} color="transparent" />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </CanvasActionsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Public export — wraps with ReactFlowProvider
// ---------------------------------------------------------------------------

export function ContextCanvas(props: ContextCanvasProps) {
  const memorySignature = props.state.context_items
    .filter((item) => item.layer === "memory")
    .map((item) => `${item.id}:${item.status}`)
    .join("|");
  const canvasKey = `${props.state.session_context_mode}::${memorySignature}`;

  return (
    <ReactFlowProvider key={canvasKey}>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function getRenderGroupId(
  groupId: string,
  layer: ContextLayer | string,
  currentMode: CanvasState["session_context_mode"],
) {
  return layer === "memory" || groupId === "group-memory"
    ? `${groupId}::${currentMode}`
    : groupId;
}

function getRenderItemId(
  item: ContextItem,
  currentMode: CanvasState["session_context_mode"],
) {
  return item.layer === "memory" ? `${item.id}::${currentMode}` : item.id;
}
