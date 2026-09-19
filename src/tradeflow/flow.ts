/** One aggregated trade. `buy` = aggressor was a buyer (taker lifted the ask). */
export interface Trade { t: number; price: number; usd: number; buy: boolean }

interface Bucket { sec: number; buyUsd: number; sellUsd: number; buyN: number; sellN: number; first: number; last: number }

export const FLOW_WINDOWS = [
  { label: "30s", sec: 30 },
  { label: "1m", sec: 60 },
  { label: "5m", sec: 300 },
  { label: "15m", sec: 900 },
] as const;

const KEEP_SEC = 900;
const MAX_LARGE = 40;

export interface FlowWindow {
  label: string;
  sec: number;
  buyUsd: number;
  sellUsd: number;
  deltaUsd: number;
  buyPct: number; // 0..100 share of taker volume
  trades: number;
  priceChangePct: number;
  covered: boolean; // false while we have collected less than the window length
  signal: FlowSignal;
}

export type FlowSignal = "BUYERS" | "SELLERS" | "BALANCED" | "ABSORPTION_SELL" | "ABSORPTION_BUY";

export interface LargeTrade extends Trade { multiple: number }

export interface FlowSnapshot {
  windows: FlowWindow[];
  cvd: number; // cumulative delta since connect, USD
  cvdSeries: { t: number; v: number }[]; // per-second, last 15m
  largeThreshold: number;
  large: LargeTrade[]; // newest first
  largeBuyUsd: number; // last 15m
  largeSellUsd: number;
  collectedSec: number;
}

/** Classify a window: who is aggressive, and whether price disagrees with the flow (absorption). */
export function classify(buyPct: number, deltaUsd: number, totalUsd: number, priceChangePct: number): FlowSignal {
  if (totalUsd <= 0) return "BALANCED";
  const skew = buyPct - 50;
  const flat = 0.03; // price moves under 3bp are noise
  if (skew >= 8 && priceChangePct <= -flat) return "ABSORPTION_BUY"; // heavy buying, price not rising: sellers absorbing
  if (skew <= -8 && priceChangePct >= flat) return "ABSORPTION_SELL"; // heavy selling, price not falling: buyers absorbing
  if (skew >= 8) return "BUYERS";
  if (skew <= -8) return "SELLERS";
  return "BALANCED";
}

/** Rolling taker-flow store: per-second buckets (bounded memory regardless of trade rate) plus a large-trade tape. */
export class FlowStore {
  private buckets: Bucket[] = [];
  private large: LargeTrade[] = [];
  private cvd = 0;
  private startedAt = 0;
  private usdSum = 0; // trade-size baseline over the kept window
  private nSum = 0;

  add(tr: Trade): void {
    const sec = Math.floor(tr.t / 1000);
    if (!this.startedAt) this.startedAt = sec;
    let b = this.buckets[this.buckets.length - 1];
    if (!b || b.sec !== sec) {
      if (b && sec < b.sec) return; // late out-of-order trade; ignore
      b = { sec, buyUsd: 0, sellUsd: 0, buyN: 0, sellN: 0, first: tr.price, last: tr.price };
      this.buckets.push(b);
      const cutoff = sec - KEEP_SEC;
      while (this.buckets.length && this.buckets[0].sec <= cutoff) {
        const o = this.buckets.shift()!;
        this.usdSum -= o.buyUsd + o.sellUsd; this.nSum -= o.buyN + o.sellN;
      }
    }
    if (tr.buy) { b.buyUsd += tr.usd; b.buyN++; this.cvd += tr.usd; } else { b.sellUsd += tr.usd; b.sellN++; this.cvd -= tr.usd; }
    b.last = tr.price;
    this.usdSum += tr.usd; this.nSum++;

    const thr = this.largeThreshold();
    if (tr.usd >= thr) {
      const avg = this.nSum ? this.usdSum / this.nSum : tr.usd;
      this.large.unshift({ ...tr, multiple: tr.usd / avg });
      if (this.large.length > MAX_LARGE) this.large.pop();
    }
  }

  /** Large = at least 30x the average trade over the last 15m, never under $10k (so quiet coins do not flag dust). */
  largeThreshold(): number {
    const avg = this.nSum ? this.usdSum / this.nSum : 0;
    return Math.max(10_000, avg * 30);
  }

  snapshot(nowMs: number): FlowSnapshot {
    const nowSec = Math.floor(nowMs / 1000);
    const collectedSec = this.startedAt ? nowSec - this.startedAt + 1 : 0;
    const windows = FLOW_WINDOWS.map((w): FlowWindow => {
      const from = nowSec - w.sec;
      let buyUsd = 0, sellUsd = 0, trades = 0, first: number | null = null, last: number | null = null;
      for (const b of this.buckets) {
        if (b.sec <= from) continue;
        buyUsd += b.buyUsd; sellUsd += b.sellUsd; trades += b.buyN + b.sellN;
        if (first === null) first = b.first;
        last = b.last;
      }
      const total = buyUsd + sellUsd;
      const buyPct = total > 0 ? (buyUsd / total) * 100 : 50;
      const priceChangePct = first && last ? ((last - first) / first) * 100 : 0;
      const deltaUsd = buyUsd - sellUsd;
      return { label: w.label, sec: w.sec, buyUsd, sellUsd, deltaUsd, buyPct, trades, priceChangePct, covered: collectedSec >= w.sec, signal: classify(buyPct, deltaUsd, total, priceChangePct) };
    });

    const cvdSeries: { t: number; v: number }[] = [];
    let run = this.cvd - this.buckets.reduce((s, b) => s + b.buyUsd - b.sellUsd, 0);
    for (const b of this.buckets) { run += b.buyUsd - b.sellUsd; cvdSeries.push({ t: b.sec, v: run }); }

    const cutoff = nowMs - KEEP_SEC * 1000;
    const recent = this.large.filter((l) => l.t >= cutoff);
    return {
      windows, cvd: this.cvd, cvdSeries, largeThreshold: this.largeThreshold(), large: recent, collectedSec,
      largeBuyUsd: recent.filter((l) => l.buy).reduce((s, l) => s + l.usd, 0),
      largeSellUsd: recent.filter((l) => !l.buy).reduce((s, l) => s + l.usd, 0),
    };
  }
}
