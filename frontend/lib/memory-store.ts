import "server-only";

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  MemoryEventType,
  MemoryRecord,
  SessionContextMode,
} from "@/lib/memory-types";

const DB_PATH = process.env.CONTEXTLENS_DB_PATH || resolve(process.cwd(), "..", "agent", "data", "memory.sqlite3");
const SEED_PATH = process.env.CONTEXTLENS_SEED_PATH || resolve(process.cwd(), "..", "shared", "memory-seeds.json");

function openDatabase(): DatabaseSync {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  initSchema(db);
  seedMemoriesIfEmpty(db);
  return db;
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      confidence TEXT NOT NULL,
      context_scope TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'active',
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_context_rules (
      memory_id TEXT NOT NULL,
      context_mode TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (memory_id, context_mode, rule_type)
    );

    CREATE TABLE IF NOT EXISTS memory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      context_mode TEXT,
      thread_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const columns = db.prepare("PRAGMA table_info(memories)").all() as Array<{name: string}>;
  if (!columns.some(c => c.name === "revision")) db.exec("ALTER TABLE memories ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
  db.exec(readFileSync(resolve(process.cwd(), "..", "shared", "memory-revisions.sql"), "utf8"));
}

function seedMemoriesIfEmpty(db: DatabaseSync) {
  const countRow = db
    .prepare("SELECT COUNT(*) AS count FROM memories")
    .get() as { count?: number } | undefined;
  const count = Number(countRow?.count ?? 0);
  if (count > 0) return;

  const seeds = JSON.parse(readFileSync(SEED_PATH, "utf8")) as Array<{
    id: string;
    title: string;
    content: string;
    memory_type: string;
    confidence: string;
    context_scope: string;
    source_kind: string;
    created_at: string;
  }>;

  const stmt = db.prepare(`
    INSERT INTO memories (
      id, title, content, memory_type, confidence, context_scope,
      created_at, updated_at, source_kind, lifecycle_state, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL)
  `);

  for (const seed of seeds) {
    stmt.run(
      seed.id,
      seed.title,
      seed.content,
      seed.memory_type,
      seed.confidence,
      seed.context_scope,
      seed.created_at,
      seed.created_at,
      seed.source_kind,
    );
  }
}

export function listMemories(includeTrashed = false): MemoryRecord[] {
  const db = openDatabase();
  try {
    const rows = db
      .prepare(
        `
        SELECT id
        FROM memories
        ${includeTrashed ? "" : "WHERE lifecycle_state != 'trashed'"}
        ORDER BY datetime(created_at) DESC
        `,
      )
      .all() as Array<{ id: string }>;
    return rows.map((row) => getMemoryById(db, row.id));
  } finally {
    db.close();
  }
}

export function listMemoriesForContext(
  mode: SessionContextMode,
  includeBlocked = false,
): MemoryRecord[] {
  const db = openDatabase();
  try {
    const filters = ["m.lifecycle_state = 'active'"];
    const params: Array<string> = [];

    filters.push("(m.context_scope = ? OR m.context_scope = 'general')");
    params.push(mode);

    if (!includeBlocked) {
      filters.push(`
        NOT EXISTS (
          SELECT 1 FROM memory_context_rules r
          WHERE r.memory_id = m.id
            AND r.context_mode = ?
            AND r.rule_type = 'block'
        )
      `);
      params.push(mode);
    }

    const rows = db
      .prepare(
        `
        SELECT m.id
        FROM memories m
        WHERE ${filters.join(" AND ")}
        ORDER BY datetime(m.created_at) DESC
        `,
      )
      .all(...params) as Array<{ id: string }>;
    return rows.map((row) => getMemoryById(db, row.id));
  } finally {
    db.close();
  }
}

export function blockMemoryInContext(
  memoryId: string,
  contextMode: SessionContextMode,
  threadId?: string,
) {
  const db = openDatabase();
  try {
    db.prepare(
      `
      INSERT OR IGNORE INTO memory_context_rules (memory_id, context_mode, rule_type)
      VALUES (?, ?, 'block')
      `,
    ).run(memoryId, contextMode);
    logMemoryEvent("context_block", memoryId, contextMode, threadId, db);
    return getMemoryById(db, memoryId);
  } finally {
    db.close();
  }
}

export function trashMemory(memoryId: string, threadId?: string) {
  const db = openDatabase();
  try {
    db.prepare(
      `
      UPDATE memories
      SET lifecycle_state = 'trashed',
          deleted_at = CURRENT_TIMESTAMP,
          revision = revision + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
    ).run(memoryId);
    logMemoryEvent("trash", memoryId, null, threadId, db);
    return getMemoryById(db, memoryId);
  } finally {
    db.close();
  }
}

export function restoreMemory(memoryId: string, threadId?: string) {
  const db = openDatabase();
  try {
    db.prepare(
      `
      UPDATE memories
      SET lifecycle_state = 'active',
          deleted_at = NULL,
          revision = revision + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
    ).run(memoryId);
    logMemoryEvent("restore", memoryId, null, threadId, db);
    return getMemoryById(db, memoryId);
  } finally {
    db.close();
  }
}

export function logTemporaryIgnore(memoryId: string, threadId?: string) {
  const db = openDatabase();
  try {
    logMemoryEvent("temporary_ignore", memoryId, null, threadId, db);
  } finally {
    db.close();
  }
}

function logMemoryEvent(
  eventType: MemoryEventType,
  memoryId: string,
  contextMode: SessionContextMode | null,
  threadId: string | undefined,
  db: DatabaseSync,
) {
  db.prepare(
    `
    INSERT INTO memory_events (memory_id, event_type, context_mode, thread_id)
    VALUES (?, ?, ?, ?)
    `,
  ).run(memoryId, eventType, contextMode, threadId ?? null);
}

function getMemoryById(db: DatabaseSync, id: string): MemoryRecord {
  const row = db
    .prepare("SELECT * FROM memories WHERE id = ?")
    .get(id) as Omit<MemoryRecord, "blocked_context_modes">;
  const blockedRows = db
    .prepare(
      `
      SELECT context_mode
      FROM memory_context_rules
      WHERE memory_id = ? AND rule_type = 'block'
      ORDER BY context_mode
      `,
    )
    .all(id) as Array<{ context_mode: SessionContextMode }>;

  return {
    ...row,
    blocked_context_modes: blockedRows.map((blockedRow) => blockedRow.context_mode),
  };
}

export function unblockMemoryInContext(memoryId: string, mode: SessionContextMode) {
  const db = openDatabase();
  try {
    db.prepare("DELETE FROM memory_context_rules WHERE memory_id = ? AND context_mode = ? AND rule_type = 'block'").run(memoryId, mode);
    logMemoryEvent("context_unblock", memoryId, mode, undefined, db);
    return getMemoryById(db, memoryId);
  } finally { db.close(); }
}

export function saveMemory(input: { id?: string; revision?: number; title: string; content: string; context_scope: SessionContextMode; source_kind: string }): MemoryRecord {
  const db = openDatabase();
  try {
    if (input.id) {
      const result = db.prepare("UPDATE memories SET title=?, content=?, context_scope=?, source_kind=?, revision=revision+1, updated_at=? WHERE id=? AND revision=? AND lifecycle_state='active'")
        .run(input.title, input.content, input.context_scope, input.source_kind, new Date().toISOString(), input.id, input.revision ?? -1);
      if (result.changes !== 1) throw new Error("Memory changed or unavailable; refresh before editing");
    } else {
      input.id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO memories (id,title,content,memory_type,confidence,context_scope,created_at,updated_at,source_kind,revision) VALUES (?,?,?,'semantic','high',?,?,?,?,1)")
        .run(input.id, input.title, input.content, input.context_scope, now, now, input.source_kind);
    }
    return getMemoryById(db, input.id);
  } finally { db.close(); }
}
