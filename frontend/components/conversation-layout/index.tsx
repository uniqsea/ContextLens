"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// ConversationLayout — resizable two-column split (chat | canvas)
// ---------------------------------------------------------------------------

interface ConversationLayoutProps {
  chatContent: ReactNode;
  inspectorContent: ReactNode;
}

const MIN_CHAT_W = 360;
const MIN_INSPECTOR_W = 420;
const DESKTOP_BP = 1024;
const DEFAULT_INSPECTOR_RATIO = 0.6;

export function ConversationLayout({
  chatContent,
  inspectorContent,
}: ConversationLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDesktop, setIsDesktop] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Responsive breakpoint
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_BP}px)`);
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Drag-to-resize
  const onPointerDown = useCallback(() => setIsDragging(true), []);

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newInspector = rect.right - e.clientX;
      const clamped = Math.max(
        MIN_INSPECTOR_W,
        Math.min(newInspector, rect.width - MIN_CHAT_W),
      );
      setInspectorWidth(clamped);
    };

    const onUp = () => setIsDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDragging]);

  // Mobile: vertical stack
  if (!isDesktop) {
    return (
      <div className="flex h-dvh flex-col">
        <div className="h-[42vh] min-h-0 overflow-hidden">{chatContent}</div>
        <div className="flex-1 min-h-0 overflow-hidden">{inspectorContent}</div>
      </div>
    );
  }

  // Desktop: horizontal split
  const inspectorStyle = inspectorWidth
    ? { width: inspectorWidth }
    : { width: `${DEFAULT_INSPECTOR_RATIO * 100}%` };

  return (
    <div ref={containerRef} className="flex h-dvh">
      <div className="flex-1 min-w-0 overflow-hidden">{chatContent}</div>

      {/* Drag handle */}
      <div
        onPointerDown={onPointerDown}
        className={`w-1 cursor-col-resize transition-colors hover:bg-neutral-300 dark:hover:bg-neutral-700 ${
          isDragging ? "bg-neutral-400 dark:bg-neutral-600" : "bg-neutral-200 dark:bg-neutral-800"
        }`}
      />

      <div
        className="min-w-0 overflow-hidden"
        style={inspectorStyle}
      >
        {inspectorContent}
      </div>
    </div>
  );
}
