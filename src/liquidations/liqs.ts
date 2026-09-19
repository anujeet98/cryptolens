/** One forced liquidation. `side` is the position that was liquidated: a SELL force-order closes a long. */
export interface LiqEvent { t: number; symbol: string; side: "long" | "short"; price: number; usd: number }

export const LIQ_WINDOWS = [
  { label: "5m", sec: 300 },
  { label: "15m", sec: 900 },
  { label: "1h", sec: 3600 },
] as const;

const KEEP_MS = 3600_000;
const MAX_EVENTS = 20_000;
const BURST_MIN_USD = 50_000;
const BURST_MULT = 3;

export interface LiqWindow { label: string; sec: number; longUsd: number; shortUsd: number; count: number; largest: number; covered: boolean }
export interface TopLiq { symbol: string; longUsd: number; shortUsd: number; count: number }

export interface LiqSnapshot {
  windows: LiqWindow[];
  recent: LiqEvent[]; // selected symbol, newest first
  burst: { active: boolean; lastMinUsd: number; avgMinUsd: number; dominant: "long" | "short" | null };
  market: { longUsd: number; shortUsd: number; count: number; top: TopLiq[] }; // last 15m, all symbols
  collectedSec: number;
}

/** Parse a Binance `forceOrder` payload. Notional uses the average fill price, not the (often far) limit price. */
export function parseForceOrder(d: { o?: { s: string; S: string; ap: string; p: string; z: string; q: string; T: number } }): LiqEvent | null {
  const o = d?.o;
  if (!o) return null;
  const price = +o.ap > 0 ? +o.ap : +o.p;
  const qty = +o.z > 0 ? +o.z : +o.q;
  const usd = price * qty;
  if (!isFinite(usd) || usd <= 0 || !o.s) return null;
  return { t: o.T, symbol: o.s, side: o.S === "SELL" ? "long" : "short", price, usd };
}

/** Rolling in-memory liquidation store. Events are kept for one hour, bounded by count. */
export class LiqStore {
  private events: LiqEvent[] = []; // oldest first
  private startedAt = 0;

  add(e: LiqEvent): void {
    if (!this.startedAt) this.startedAt = e.t;
    this.events.push(e);
    const cutoff = e.t - KEEP_MS;
    let drop = 0;
    while (drop < this.events.length && this.events[drop].t < cutoff) drop++;
    if (this.events.length - drop > MAX_EVENTS) drop = this.events.length - MAX_EVENTS;
    if (drop) this.events.splice(0, drop);
  }

  /** `since` is when we began listening; windows longer than that are flagged partial. */
  snapshot(nowMs: number, symbol: string | null, since: number): LiqSnapshot {
    const collectedSec = since ? Math.max(0, Math.floor((nowMs - since) / 1000)) : 0;
    const mine = symbol ? this.events.filter((e) => e.symbol === symbol) : [];

    const windows = LIQ_WINDOWS.map((w): LiqWindow => {
      const from = nowMs - w.sec * 1000;
      let longUsd = 0, shortUsd = 0, count = 0, largest = 0;
      for (const e of mine) {
        if (e.t < from) continue;
        if (e.side === "long") longUsd += e.usd; else shortUsd += e.usd;
        count++; largest = Math.max(largest, e.usd);
      }
      return { label: w.label, sec: w.sec, longUsd, shortUsd, count, largest, covered: collectedSec >= w.sec };
    });

    // Burst: the last minute is well above this symbol's own per-minute average over the collected hour.
    const lastMin = mine.filter((e) => e.t >= nowMs - 60_000);
    const lastMinUsd = lastMin.reduce((s, e) => s + e.usd, 0);
    const hourUsd = mine.reduce((s, e) => s + e.usd, 0);
    const minutes = Math.max(1, Math.min(60, collectedSec / 60));
    const avgMinUsd = hourUsd / minutes;
    const active = lastMinUsd >= BURST_MIN_USD && lastMinUsd >= avgMinUsd * BURST_MULT && collectedSec >= 300;
    const lm = lastMin.filter((e) => e.side === "long").reduce((s, e) => s + e.usd, 0);
    const dominant = !active ? null : lm >= lastMinUsd - lm ? "long" : "short";

    const from15 = nowMs - 900_000;
    const by = new Map<string, TopLiq>();
    let mLong = 0, mShort = 0, mCount = 0;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e.t < from15) break;
      const r = by.get(e.symbol) ?? { symbol: e.symbol, longUsd: 0, shortUsd: 0, count: 0 };
      if (e.side === "long") { r.longUsd += e.usd; mLong += e.usd; } else { r.shortUsd += e.usd; mShort += e.usd; }
      r.count++; mCount++; by.set(e.symbol, r);
    }
    const top = [...by.values()].sort((a, b) => b.longUsd + b.shortUsd - (a.longUsd + a.shortUsd)).slice(0, 8);

    return {
      windows, collectedSec,
      recent: mine.slice(-25).reverse(),
      burst: { active, lastMinUsd, avgMinUsd, dominant },
      market: { longUsd: mLong, shortUsd: mShort, count: mCount, top },
    };
  }
}
