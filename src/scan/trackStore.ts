/**
 * Local, append-only log of signals an MCP caller chose to follow up on. Deliberately not automatic —
 * every call scans dozens of coins and most aren't worth remembering, so only track_signal writes a row,
 * on request. This makes "did that retest from 20 minutes ago hold?" answerable without re-deriving it
 * from memory, and turns the tools from stateless lookups into something with real history.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_TRACKER_DB_PATH = "data/scan-tracker.db";

export type TrackedKind = "scan_pick" | "retest";

export interface TrackedSignal {
  id: number;
  symbol: string;
  timeframe: string;
  kind: TrackedKind;
  loggedAtMs: number;
  note: string | null;
  /** Frozen at log time: price + whatever the relevant tool returned (regime/stage, or retest result). */
  snapshot: unknown;
}

const SCHEMA = `
  CREATE TABLE tracked_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    kind TEXT NOT NULL,
    logged_at_ms INTEGER NOT NULL,
    note TEXT,
    snapshot_json TEXT NOT NULL
  );
  CREATE INDEX tracked_signals_symbol ON tracked_signals (symbol);
  CREATE INDEX tracked_signals_logged_at ON tracked_signals (logged_at_ms);
`;

export function openTrackerDb(path: string = DEFAULT_TRACKER_DB_PATH): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tracked_signals'").get();
  if (!exists) db.exec(SCHEMA);
  return db;
}

export function trackSignal(
  db: DatabaseSync,
  input: { symbol: string; timeframe: string; kind: TrackedKind; note?: string; snapshot: unknown; nowMs?: number },
): number {
  const row = db
    .prepare("INSERT INTO tracked_signals (symbol, timeframe, kind, logged_at_ms, note, snapshot_json) VALUES (?,?,?,?,?,?)")
    .run(
      input.symbol,
      input.timeframe,
      input.kind,
      input.nowMs ?? Date.now(),
      input.note ?? null,
      JSON.stringify(input.snapshot),
    );
  return Number(row.lastInsertRowid);
}

interface Row {
  id: number;
  symbol: string;
  timeframe: string;
  kind: string;
  logged_at_ms: number;
  note: string | null;
  snapshot_json: string;
}

function fromRow(r: Row): TrackedSignal {
  return {
    id: r.id,
    symbol: r.symbol,
    timeframe: r.timeframe,
    kind: r.kind as TrackedKind,
    loggedAtMs: r.logged_at_ms,
    note: r.note,
    snapshot: JSON.parse(r.snapshot_json),
  };
}

export function getTrackedSignal(db: DatabaseSync, id: number): TrackedSignal | null {
  const row = db.prepare("SELECT * FROM tracked_signals WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : null;
}

export function listTrackedSignals(
  db: DatabaseSync,
  opts: { symbol?: string; sinceMs?: number; limit?: number } = {},
): TrackedSignal[] {
  const { symbol, sinceMs, limit = 50 } = opts;
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (symbol) {
    clauses.push("symbol = ?");
    params.push(symbol);
  }
  if (sinceMs !== undefined) {
    clauses.push("logged_at_ms >= ?");
    params.push(sinceMs);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM tracked_signals ${where} ORDER BY logged_at_ms DESC LIMIT ?`)
    .all(...params, limit) as unknown as Row[];
  return rows.map(fromRow);
}
