import type { DatabaseSync } from "node:sqlite";
import type { LiquidationRow, SnapshotRow } from "./db";

type Raw = Record<string, number | string | null>;

const toSnapshot = (r: Raw): SnapshotRow => ({
  symbol: r.symbol as string, ts: r.ts as number,
  open: r.open as number | null, high: r.high as number | null, low: r.low as number | null, close: r.close as number | null,
  buyUsd: r.buy_usd as number, sellUsd: r.sell_usd as number, buyN: r.buy_n as number, sellN: r.sell_n as number,
  maxBuyUsd: r.max_buy_usd as number, maxSellUsd: r.max_sell_usd as number,
  mark: r.mark as number | null, indexPrice: r.index_price as number | null, fundingRate: r.funding_rate as number | null, oiUsd: r.oi_usd as number | null,
  mid: r.mid as number | null, spreadBps: r.spread_bps as number | null,
  bidUsd10bp: r.bid_usd_10bp as number | null, askUsd10bp: r.ask_usd_10bp as number | null, bidUsd50bp: r.bid_usd_50bp as number | null, askUsd50bp: r.ask_usd_50bp as number | null,
  flags: r.flags as number,
});

/** Snapshots for one symbol with fromSec <= ts <= toSec, oldest first. */
export function getSnapshots(db: DatabaseSync, symbol: string, fromSec: number, toSec: number): SnapshotRow[] {
  return (db.prepare("SELECT * FROM snapshots WHERE symbol = ? AND ts >= ? AND ts <= ? ORDER BY ts").all(symbol, fromSec, toSec) as Raw[]).map(toSnapshot);
}

/** Liquidations with fromMs <= t <= toMs, oldest first. `symbol` null = market-wide. */
export function getLiquidations(db: DatabaseSync, symbol: string | null, fromMs: number, toMs: number): LiquidationRow[] {
  const rows = symbol
    ? db.prepare("SELECT * FROM liquidations WHERE symbol = ? AND t >= ? AND t <= ? ORDER BY t").all(symbol, fromMs, toMs)
    : db.prepare("SELECT * FROM liquidations WHERE t >= ? AND t <= ? ORDER BY t").all(fromMs, toMs);
  return rows as unknown as LiquidationRow[];
}

export interface Gap { fromTs: number; toTs: number; minutes: number } // missing minute starts, inclusive

export interface Coverage {
  symbol: string;
  rows: number;
  firstTs: number | null;
  lastTs: number | null;
  expectedRows: number; // minutes between first and last, inclusive
  missingMinutes: number;
  gaps: Gap[]; // runs of >= minGapMinutes missing minutes
  partialRows: number; // ws-gap flagged
  restMissingRows: number;
  cleanRows: number; // no flags at all: safe to use without caveats
}

/** How trustworthy is the recorded history? A backtest should look at this before trusting any window. */
export function coverage(db: DatabaseSync, symbol: string, minGapMinutes = 2): Coverage {
  const ts = (db.prepare("SELECT ts, flags FROM snapshots WHERE symbol = ? ORDER BY ts").all(symbol) as { ts: number; flags: number }[]);
  const empty: Coverage = { symbol, rows: 0, firstTs: null, lastTs: null, expectedRows: 0, missingMinutes: 0, gaps: [], partialRows: 0, restMissingRows: 0, cleanRows: 0 };
  if (!ts.length) return empty;
  const gaps: Gap[] = [];
  let missing = 0;
  for (let i = 1; i < ts.length; i++) {
    const m = (ts[i].ts - ts[i - 1].ts) / 60 - 1;
    if (m > 0) { missing += m; if (m >= minGapMinutes) gaps.push({ fromTs: ts[i - 1].ts + 60, toTs: ts[i].ts - 60, minutes: m }); }
  }
  return {
    symbol, rows: ts.length, firstTs: ts[0].ts, lastTs: ts[ts.length - 1].ts,
    expectedRows: (ts[ts.length - 1].ts - ts[0].ts) / 60 + 1, missingMinutes: missing, gaps,
    partialRows: ts.filter((r) => r.flags & 1).length, restMissingRows: ts.filter((r) => r.flags & 2).length, cleanRows: ts.filter((r) => r.flags === 0).length,
  };
}
