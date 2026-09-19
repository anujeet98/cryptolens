import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const SCHEMA_VERSION = 1;
export const DEFAULT_DB_PATH = "data/cryptolens.db";

/** Bit flags on a snapshot row. */
export const FLAG_WS_GAP = 1; // flow stream was down during this minute: flow totals are a lower bound
export const FLAG_REST_MISSING = 2; // derivatives/order-book sample failed: those columns are NULL

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE snapshots (
    symbol TEXT NOT NULL,
    ts INTEGER NOT NULL,             -- minute START, unix seconds (same convention as a candle time)
    open REAL, high REAL, low REAL, close REAL,
    buy_usd REAL NOT NULL, sell_usd REAL NOT NULL,
    buy_n INTEGER NOT NULL, sell_n INTEGER NOT NULL,
    max_buy_usd REAL NOT NULL, max_sell_usd REAL NOT NULL,
    mark REAL, index_price REAL, funding_rate REAL, oi_usd REAL,   -- sampled ~1s after the minute closes
    mid REAL, spread_bps REAL,
    bid_usd_10bp REAL, ask_usd_10bp REAL, bid_usd_50bp REAL, ask_usd_50bp REAL,  -- depth within 0.1% / 0.5% of mid; NULL if the book does not reach that far
    flags INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (symbol, ts)
  ) WITHOUT ROWID;
  CREATE TABLE liquidations (
    t INTEGER NOT NULL,              -- exchange time, ms
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,              -- 'long' or 'short': the position that was liquidated
    price REAL NOT NULL,
    usd REAL NOT NULL
  );
  CREATE INDEX liquidations_symbol_t ON liquidations (symbol, t);
  CREATE INDEX liquidations_t ON liquidations (t);
  CREATE TABLE runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started INTEGER NOT NULL,        -- unix seconds
    heartbeat INTEGER NOT NULL,      -- last time the recorder was known alive; a crash leaves this as the end of the run
    symbols TEXT NOT NULL
  );
  `,
];

/** Open (creating and migrating if needed) a recorder database. Pass ":memory:" for tests. */
export function openDb(path: string = DEFAULT_DB_PATH): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;"); // WAL: the web app can read while the recorder writes
  const cur = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (cur > SCHEMA_VERSION) throw new Error(`Database schema v${cur} is newer than this code (v${SCHEMA_VERSION}); update the app.`);
  for (let v = cur; v < SCHEMA_VERSION; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  return db;
}

export interface SnapshotRow {
  symbol: string; ts: number;
  open: number | null; high: number | null; low: number | null; close: number | null;
  buyUsd: number; sellUsd: number; buyN: number; sellN: number; maxBuyUsd: number; maxSellUsd: number;
  mark: number | null; indexPrice: number | null; fundingRate: number | null; oiUsd: number | null;
  mid: number | null; spreadBps: number | null;
  bidUsd10bp: number | null; askUsd10bp: number | null; bidUsd50bp: number | null; askUsd50bp: number | null;
  flags: number;
}

export interface LiquidationRow { t: number; symbol: string; side: "long" | "short"; price: number; usd: number }

const SNAP_COLS = ["symbol", "ts", "open", "high", "low", "close", "buy_usd", "sell_usd", "buy_n", "sell_n", "max_buy_usd", "max_sell_usd", "mark", "index_price", "funding_rate", "oi_usd", "mid", "spread_bps", "bid_usd_10bp", "ask_usd_10bp", "bid_usd_50bp", "ask_usd_50bp", "flags"] as const;

/** Idempotent: writing the same (symbol, ts) again replaces it. */
export function insertSnapshots(db: DatabaseSync, rows: SnapshotRow[]): void {
  if (!rows.length) return;
  const st = db.prepare(`INSERT OR REPLACE INTO snapshots (${SNAP_COLS.join(",")}) VALUES (${SNAP_COLS.map(() => "?").join(",")})`);
  db.exec("BEGIN");
  try {
    for (const r of rows) {
      st.run(r.symbol, r.ts, r.open, r.high, r.low, r.close, r.buyUsd, r.sellUsd, r.buyN, r.sellN, r.maxBuyUsd, r.maxSellUsd,
        r.mark, r.indexPrice, r.fundingRate, r.oiUsd, r.mid, r.spreadBps, r.bidUsd10bp, r.askUsd10bp, r.bidUsd50bp, r.askUsd50bp, r.flags);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

export function insertLiquidations(db: DatabaseSync, rows: LiquidationRow[]): void {
  if (!rows.length) return;
  const st = db.prepare("INSERT INTO liquidations (t, symbol, side, price, usd) VALUES (?,?,?,?,?)");
  db.exec("BEGIN");
  try {
    for (const r of rows) st.run(r.t, r.symbol, r.side, r.price, r.usd);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

/** Delete data older than the retention windows. Returns rows removed. */
export function prune(db: DatabaseSync, nowSec: number, snapshotDays = 180, liquidationDays = 90): { snapshots: number; liquidations: number } {
  const s = db.prepare("DELETE FROM snapshots WHERE ts < ?").run(nowSec - snapshotDays * 86400);
  const l = db.prepare("DELETE FROM liquidations WHERE t < ?").run((nowSec - liquidationDays * 86400) * 1000);
  return { snapshots: Number(s.changes), liquidations: Number(l.changes) };
}
