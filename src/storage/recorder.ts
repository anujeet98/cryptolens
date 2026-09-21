import type { DatabaseSync } from "node:sqlite";
import { analyzeBook } from "@/orderbook/analysis";
import { MinuteAggregator, type MinuteFlow } from "./aggregate";
import {
  FLAG_REST_MISSING,
  FLAG_WS_GAP,
  insertLiquidations,
  insertSnapshots,
  type LiquidationRow,
  type SnapshotRow,
} from "./db";

export interface DerivSample {
  mark: number;
  index: number;
  fundingRate: number;
  oiUsd: number;
}
export interface BookSample {
  bids: [number, number][];
  asks: [number, number][];
}

export interface RecorderDeps {
  /** Each sampler may throw; the row is still written with FLAG_REST_MISSING. */
  sampleDerivs(symbol: string): Promise<DerivSample>;
  sampleBook(symbol: string): Promise<BookSample>;
  log?: (msg: string) => void;
}

export interface BookMetrics {
  mid: number;
  spreadBps: number;
  bidUsd10bp: number | null;
  askUsd10bp: number | null;
  bidUsd50bp: number | null;
  askUsd50bp: number | null;
}

/** Depth within 0.1% and 0.5% of mid. A band the loaded book does not fully reach is stored as NULL, never as a misleading lower bound. */
export function bookMetrics(bids: [number, number][], asks: [number, number][]): BookMetrics | null {
  const a = analyzeBook(bids, asks);
  if (!a) return null;
  const band = (pct: number) => a.bands.find((b) => b.pct === pct);
  const b10 = band(0.1),
    b50 = band(0.5);
  return {
    mid: a.mid,
    spreadBps: a.spreadBps,
    bidUsd10bp: b10?.complete ? b10.bidUsd : null,
    askUsd10bp: b10?.complete ? b10.askUsd : null,
    bidUsd50bp: b50?.complete ? b50.bidUsd : null,
    askUsd50bp: b50?.complete ? b50.askUsd : null,
  };
}

const minuteStart = (ms: number) => Math.floor(ms / 60_000) * 60;

/**
 * Turns a live feed into rows. I/O-free apart from the DB and the injected samplers, so it is fully testable.
 * A row at `ts` covers [ts, ts+60s). Flow comes from the trade stream by exchange time; derivatives and book
 * are REST samples taken when the minute closes, so only the most recent minute can carry them.
 */
export class Recorder {
  private agg = new Map<string, MinuteAggregator>();
  private liqBuf: LiquidationRow[] = [];
  private busy = false;
  private runId: number;

  constructor(
    private db: DatabaseSync,
    readonly symbols: string[],
    private deps: RecorderDeps,
    nowMs = Date.now(),
  ) {
    for (const s of symbols) this.agg.set(s, new MinuteAggregator());
    const r = db
      .prepare("INSERT INTO runs (started, heartbeat, symbols) VALUES (?,?,?)")
      .run(Math.floor(nowMs / 1000), Math.floor(nowMs / 1000), symbols.join(","));
    this.runId = Number(r.lastInsertRowid);
  }

  /** aggTrade: `buyerIsMaker` true means the taker sold. Untracked symbols are ignored. */
  onTrade(symbol: string, tMs: number, price: number, qty: number, buyerIsMaker: boolean): void {
    const a = this.agg.get(symbol);
    if (!a || !(price > 0) || !(qty > 0)) return;
    a.add(tMs, price, price * qty, !buyerIsMaker);
  }

  onLiquidation(e: LiquidationRow): void {
    this.liqBuf.push(e);
  }

  markDown(nowMs: number): void {
    for (const a of this.agg.values()) a.markDown(nowMs);
  }
  markUp(nowMs: number): void {
    for (const a of this.agg.values()) a.markUp(nowMs);
  }

  /** Call once a minute, a moment after the boundary. Returns the number of snapshot rows written. Single-flight: an overlapping call is skipped, nothing is lost. */
  async tick(nowMs: number): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const latest = minuteStart(nowMs) - 60; // the minute that just closed
      const flushed = new Map<string, MinuteFlow[]>();
      for (const [sym, a] of this.agg) flushed.set(sym, a.flush(nowMs));

      const rows: SnapshotRow[] = [];
      await Promise.all(
        [...flushed].map(async ([symbol, minutes]) => {
          if (!minutes.length) return;
          // REST samples describe "now": attach them only to the minute that just closed, never to stale ones.
          const needsRest = minutes.some((m) => m.ts === latest);
          let d: DerivSample | null = null,
            bm: BookMetrics | null = null;
          if (needsRest) {
            const [dr, br] = await Promise.allSettled([this.deps.sampleDerivs(symbol), this.deps.sampleBook(symbol)]);
            if (dr.status === "fulfilled") d = dr.value;
            else
              this.deps.log?.(
                `${symbol} derivatives sample failed: ${dr.reason instanceof Error ? dr.reason.message : dr.reason}`,
              );
            if (br.status === "fulfilled") bm = bookMetrics(br.value.bids, br.value.asks);
            else
              this.deps.log?.(
                `${symbol} order book sample failed: ${br.reason instanceof Error ? br.reason.message : br.reason}`,
              );
          }
          for (const m of minutes) {
            const isLatest = m.ts === latest;
            const dd = isLatest ? d : null,
              bb = isLatest ? bm : null;
            rows.push({
              symbol,
              ts: m.ts,
              open: m.open,
              high: m.high,
              low: m.low,
              close: m.close,
              buyUsd: m.buyUsd,
              sellUsd: m.sellUsd,
              buyN: m.buyN,
              sellN: m.sellN,
              maxBuyUsd: m.maxBuyUsd,
              maxSellUsd: m.maxSellUsd,
              mark: dd?.mark ?? null,
              indexPrice: dd?.index ?? null,
              fundingRate: dd?.fundingRate ?? null,
              oiUsd: dd?.oiUsd ?? null,
              mid: bb?.mid ?? null,
              spreadBps: bb?.spreadBps ?? null,
              bidUsd10bp: bb?.bidUsd10bp ?? null,
              askUsd10bp: bb?.askUsd10bp ?? null,
              bidUsd50bp: bb?.bidUsd50bp ?? null,
              askUsd50bp: bb?.askUsd50bp ?? null,
              flags: (m.gap ? FLAG_WS_GAP : 0) | (dd && bb ? 0 : FLAG_REST_MISSING),
            });
          }
        }),
      );

      insertSnapshots(this.db, rows);
      const liqs = this.liqBuf;
      this.liqBuf = [];
      insertLiquidations(this.db, liqs);
      this.db.prepare("UPDATE runs SET heartbeat = ? WHERE id = ?").run(Math.floor(nowMs / 1000), this.runId);
      return rows.length;
    } finally {
      this.busy = false;
    }
  }
}
