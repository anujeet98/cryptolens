import type { MarketType } from "@/types/market";

export type Level = [price: number, qty: number];

/** Raw Binance depthUpdate payload, already number-parsed. Spot has no `pu`. */
export interface DepthEvent { U: number; u: number; pu?: number; b: Level[]; a: Level[] }
export interface DepthSnapshot { lastUpdateId: number; bids: Level[]; asks: Level[] }

export type AcceptResult = "buffered" | "applied" | "stale" | "gap";

/**
 * Local order book maintained per Binance's documented procedure:
 *  1. buffer WS events, 2. fetch REST snapshot, 3. drop events already covered by the snapshot,
 *  4. the first applied event must straddle the snapshot id, 5. every later event must chain onto the previous one.
 * Any break in the chain returns "gap" — the caller must discard the book and resync.
 * Spot chains on U == prev.u + 1; futures chains on pu == prev.u.
 */
export class LocalOrderBook {
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private buffer: DepthEvent[] = [];
  private snapId: number | null = null;
  private lastU: number | null = null;
  constructor(private market: MarketType) {}

  get synced() { return this.snapId !== null; }
  get lastUpdateId() { return this.lastU ?? this.snapId; }

  reset() {
    this.bids.clear(); this.asks.clear(); this.buffer = []; this.snapId = null; this.lastU = null;
  }

  /** Feed a WS event. Before a snapshot exists events are buffered. */
  accept(e: DepthEvent): AcceptResult {
    if (this.snapId === null) {
      this.buffer.push(e);
      if (this.buffer.length > 5000) this.buffer.shift();
      return "buffered";
    }
    return this.apply(e);
  }

  /** Load the REST snapshot and replay buffered events. Returns "gap" if the snapshot is too old to bridge to the stream. */
  loadSnapshot(s: DepthSnapshot): "ok" | "gap" {
    this.bids = new Map(s.bids.filter(([, q]) => q > 0)); // Map ctor keeps [price, qty] pairs
    this.asks = new Map(s.asks.filter(([, q]) => q > 0));
    this.snapId = s.lastUpdateId;
    this.lastU = null;
    const buf = this.buffer;
    this.buffer = [];
    for (const e of buf) if (this.apply(e) === "gap") { this.reset(); return "gap"; }
    return "ok";
  }

  private apply(e: DepthEvent): AcceptResult {
    const id = this.snapId!;
    if (this.lastU === null) {
      const stale = this.market === "spot" ? e.u <= id : e.u < id;
      if (stale) return "stale";
      const bridges = this.market === "spot" ? e.U <= id + 1 && id + 1 <= e.u : e.U <= id && id <= e.u;
      if (!bridges) return "gap";
    } else {
      const chained = this.market === "spot" ? e.U === this.lastU + 1 : e.pu === this.lastU;
      if (!chained) return e.u <= this.lastU ? "stale" : "gap";
    }
    for (const [p, q] of e.b) { if (q === 0) this.bids.delete(p); else this.bids.set(p, q); }
    for (const [p, q] of e.a) { if (q === 0) this.asks.delete(p); else this.asks.set(p, q); }
    this.lastU = e.u;
    return "applied";
  }

  /** Sorted views (bids high→low, asks low→high), capped to `depth` levels. */
  view(depth = 1000): { bids: Level[]; asks: Level[] } {
    const b = [...this.bids].sort((x, y) => y[0] - x[0]).slice(0, depth);
    const a = [...this.asks].sort((x, y) => x[0] - y[0]).slice(0, depth);
    return { bids: b, asks: a };
  }

  /** Crossed book means we missed something — treat as corruption. */
  isCrossed(): boolean {
    const { bids, asks } = this.view(1);
    return bids.length > 0 && asks.length > 0 && bids[0][0] >= asks[0][0];
  }
}
