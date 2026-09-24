/**
 * Support/resistance levels from confirmed swing pivots, clustered into zones by touch count.
 * Pure function of candle history — no exchange calls, no live-clock dependence.
 */
import { pivots } from "@/indicators";
import type { Candle } from "@/types/market";

export interface Level {
  price: number;
  type: "support" | "resistance";
  touches: number;
  firstTouchIndex: number;
  lastTouchIndex: number;
}

export interface LevelOptions {
  /** Pivot confirmation window: a pivot needs this many bars on each side lower/higher than it. */
  pivotWindow?: number;
  /** Cluster tolerance as a multiple of ATR%. Two pivots within this band merge into one level. */
  clusterAtrMult?: number;
}

/** ATR% (of price) per bar, simple mean-true-range approximation good enough for clustering tolerance. */
function atrPctSeries(candles: Candle[], n = 14): number[] {
  const out: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      out.push(((candles[i].high - candles[i].low) / candles[i].close) * 100);
      continue;
    }
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    out.push((tr / candles[i].close) * 100);
  }
  const smoothed: number[] = [];
  for (let i = 0; i < out.length; i++) {
    const seg = out.slice(Math.max(0, i - n + 1), i + 1);
    smoothed.push(seg.reduce((a, b) => a + b, 0) / seg.length);
  }
  return smoothed;
}

function clusterPivots(pts: { index: number; price: number }[], tolPct: number, type: Level["type"]): Level[] {
  const sorted = [...pts].sort((a, b) => a.price - b.price);
  const levels: Level[] = [];
  let group: typeof sorted = [];
  const flush = () => {
    if (!group.length) return;
    const price = group.reduce((s, p) => s + p.price, 0) / group.length;
    levels.push({
      price,
      type,
      touches: group.length,
      firstTouchIndex: Math.min(...group.map((p) => p.index)),
      lastTouchIndex: Math.max(...group.map((p) => p.index)),
    });
    group = [];
  };
  for (const p of sorted) {
    if (group.length && Math.abs(p.price - group[group.length - 1].price) / group[group.length - 1].price > tolPct / 100) {
      flush();
    }
    group.push(p);
  }
  flush();
  return levels;
}

/** Finds support/resistance zones from confirmed swing highs/lows, most-touched first. */
export function findLevels(candles: Candle[], opts: LevelOptions = {}): Level[] {
  const { pivotWindow = 3, clusterAtrMult = 0.5 } = opts;
  if (candles.length < pivotWindow * 2 + 10) return [];

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const avgAtrPct = atrPctSeries(candles).reduce((a, b) => a + b, 0) / candles.length;
  const tolPct = Math.max(0.05, avgAtrPct * clusterAtrMult);

  const resistance = clusterPivots(pivots(highs, pivotWindow, pivotWindow, "high"), tolPct, "resistance");
  const support = clusterPivots(pivots(lows, pivotWindow, pivotWindow, "low"), tolPct, "support");

  return [...resistance, ...support].sort((a, b) => b.touches - a.touches || b.lastTouchIndex - a.lastTouchIndex);
}
