"use client";

import Link from "next/link";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Ban,
  Briefcase,
  ChevronDown,
  GraduationCap,
  Heart,
  RotateCcw,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import type { MemoryRecord, SessionContextMode } from "@/lib/memory-types";
import { cn } from "@/lib/utils";

const FILTERS: Array<{ label: string; value: SessionContextMode | "all" | "trashed" }> = [
  { label: "All", value: "all" },
  { label: "Study", value: "study" },
  { label: "Work", value: "work" },
  { label: "Personal", value: "personal" },
  { label: "Life", value: "life" },
  { label: "General", value: "general" },
  { label: "Trash", value: "trashed" },
];

const BLOCKABLE_MODES: SessionContextMode[] = ["study", "work", "personal", "life"];
const MODE_META: Record<SessionContextMode, { label: string; icon: LucideIcon }> = {
  study: { label: "Study", icon: GraduationCap },
  work: { label: "Work", icon: Briefcase },
  personal: { label: "Personal", icon: UserRound },
  life: { label: "Life", icon: Heart },
  general: { label: "General", icon: Ban },
};

export function MemoryLibrary() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const [openBlockMenuId, setOpenBlockMenuId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const menuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let cancelled = false;

    startTransition(() => {
      const url =
        filter === "all"
          ? "/api/memories?includeTrashed=true"
          : filter === "trashed"
            ? "/api/memories?includeTrashed=true"
            : `/api/memories?mode=${filter}&includeBlocked=true`;

      fetch(url)
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) {
            setMemories(data.memories ?? []);
          }
        })
        .catch(console.error);
    });

    return () => {
      cancelled = true;
    };
  }, [filter]);

  useEffect(() => {
    if (!openBlockMenuId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const currentMenu = menuRefs.current[openBlockMenuId];
      if (currentMenu && !currentMenu.contains(event.target as Node)) {
        setOpenBlockMenuId(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenBlockMenuId(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [openBlockMenuId]);

  const visibleMemories = useMemo(() => {
    if (filter === "trashed") {
      return memories.filter((memory) => memory.lifecycle_state === "trashed");
    }
    return memories;
  }, [filter, memories]);

  const refreshMemories = async () => {
    const res = await fetch("/api/memories?includeTrashed=true");
    const data = await res.json();
    setMemories(data.memories ?? []);
  };

  const runAction = async (
    memoryId: string,
    action: "context_block" | "delete_forever" | "restore",
    contextMode?: SessionContextMode,
  ) => {
    await fetch(`/api/memories/${memoryId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, contextMode }),
    });

    setOpenBlockMenuId(null);
    await refreshMemories();
  };

  return (
    <main className="min-h-dvh bg-stone-50 px-6 py-10 text-stone-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-stone-500">
              ContextLens
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">
              Memory Library
            </h1>
            {/* <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
              Persistent memory records, context blocks, and trash state backed by
              the local SQLite store.
            </p> */}
          </div>
          <Link
            href="/"
            className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-100"
          >
            Back to Assistant
          </Link>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                filter === item.value
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="rounded-3xl border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 px-6 py-4 text-sm text-stone-500">
            {isPending ? "Loading..." : `${visibleMemories.length} memories`}
          </div>
          <div className="divide-y divide-stone-200">
            {visibleMemories.map((memory) => (
              <article key={memory.id} className="px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-medium">{memory.title}</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
                      {memory.content}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge>{memory.memory_type}</Badge>
                      <Badge>{memory.context_scope}</Badge>
                      <Badge>{memory.lifecycle_state}</Badge>
                      {memory.blocked_context_modes.map((mode) => (
                        <Badge key={mode}>blocked:{mode}</Badge>
                      ))}
                    </div>
                  </div>

                  {memory.lifecycle_state !== "trashed" ? (
                    <div className="flex min-w-[220px] flex-col items-end gap-2">
                      <div
                        className="relative"
                        ref={(node) => {
                          menuRefs.current[memory.id] = node;
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenBlockMenuId((current) =>
                              current === memory.id ? null : memory.id,
                            )
                          }
                          className="flex items-center gap-1.5 rounded-full border border-amber-300 px-2.5 py-1.5 text-xs text-amber-700 transition-colors hover:bg-amber-50"
                        >
                          <Ban className="h-3 w-3" />
                          <span>Block</span>
                          <ChevronDown
                            className={`h-3 w-3 transition-transform ${
                              openBlockMenuId === memory.id ? "rotate-180" : ""
                            }`}
                          />
                        </button>

                        {openBlockMenuId === memory.id && (
                          <div className="absolute right-0 top-full z-20 mt-2 w-48 overflow-hidden rounded-[22px] border border-white/70 bg-white/92 p-2 shadow-[0_16px_40px_rgba(15,23,42,0.14)] backdrop-blur-2xl">
                            <div className="px-2.5 pb-2 pt-1">
                              <p className="text-xs font-semibold text-stone-900">
                                Block Context
                              </p>
                              <p className="text-[11px] text-stone-500">
                                Choose where this memory should not apply.
                              </p>
                            </div>
                            <div className="h-px bg-stone-200/80" />
                            <div className="py-1.5">
                              {BLOCKABLE_MODES.map((mode) => {
                                const meta = MODE_META[mode];
                                const Icon = meta.icon;

                                return (
                                  <button
                                    key={mode}
                                    type="button"
                                    onClick={() =>
                                      runAction(memory.id, "context_block", mode)
                                    }
                                    className="flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-1.5 text-left text-sm text-stone-700 transition-colors hover:bg-stone-100"
                                  >
                                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-100 text-stone-600">
                                      <Icon className="h-3 w-3" />
                                    </span>
                                    <span className="text-sm">{meta.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => runAction(memory.id, "delete_forever")}
                        className="w-full rounded-full border border-rose-300 px-3 py-1.5 text-xs text-rose-700 transition-colors hover:bg-rose-50"
                      >
                        Move to Trash
                      </button>
                    </div>
                  ) : (
                    <div className="flex min-w-[220px] flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={() => runAction(memory.id, "restore")}
                        className="flex items-center gap-1.5 rounded-full border border-emerald-300 px-3 py-1.5 text-xs text-emerald-700 transition-colors hover:bg-emerald-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Restore</span>
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
            {visibleMemories.length === 0 && (
              <div className="px-6 py-12 text-center text-sm text-stone-500">
                No memories for this filter.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Badge({ children }: { children: ReactNode }) {
  const label = String(children);
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium",
        getBadgeClasses(label),
      )}
    >
      {formatBadgeLabel(label)}
    </span>
  );
}

function formatBadgeLabel(label: string) {
  return label.replace(/\b\w/g, (char) => char.toUpperCase());
}

function getBadgeClasses(label: string) {
  const normalized = label.toLowerCase();

  if (
    normalized === "semantic" ||
    normalized === "episodic" ||
    normalized === "procedural"
  ) {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  if (
    normalized === "study" ||
    normalized === "work" ||
    normalized === "personal" ||
    normalized === "life" ||
    normalized === "general"
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (normalized === "active") {
    return "border-stone-300 bg-stone-50 text-stone-600";
  }

  if (normalized === "trashed") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (normalized.startsWith("blocked:")) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-stone-300 bg-stone-50 text-stone-600";
}
