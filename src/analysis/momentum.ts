import { atr, ema, macd, rsi, vwap, type Series } from "@/indicators";
import type { Candle } from "@/types/market";

export interface MomentumComponent { key: string; label: string; value: number; weight: number; detail: string }
export type MomentumStrength = "STRONG" | "MODERATE" | "WEAK";
export type MomentumTrend = "ACCELERATING" | "DECELERATING" | "STEADY";

export interface MomentumResult {
  score: number; // -100..+100 (sign = direction)
  previousScore: number; // score 3 bars ago
  accelerationPts: number; // direction-adjusted change over 3 bars (positive = strengthening)
  accelerationPct: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  strength: MomentumStrength;
  trend: MomentumTrend;
  condition: string; // e.g. "STRONG / DECELERATING"
  components: MomentumComponent[];
}

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const sq = (x: number) => Math.tanh(x); // smooth saturation into (-1, 1)

// Weights sum to 1. Price-derived inputs (roc, rsi, macd, body, run, ema/vwap distance) are deliberately
// modest individually so no single price transform dominates; volume is the independent confirmation.
const W = { roc: 0.2, accel: 0.1, rsi: 0.1, macd: 0.1, body: 0.1, run: 0.05, ema: 0.1, vwap: 0.05, volume: 0.2 };

interface Ctx { c: Candle[]; atr: Series; rsi: Series; hist: Series; ema20: Series; vwap: Series; qv: number[] }

function at(x: Ctx, i: number): { score: number; comps: MomentumComponent[] } | null {
  const { c } = x;
  const a = x.atr[i], r = x.rsi[i], h = x.hist[i], e = x.ema20[i], v = x.vwap[i];
  if (a === null || r === null || h === null || e === null || i < 25 || a <= 0) return null;
  const px = c[i].close;

  const roc = (px - c[i - 10].close) / a / Math.sqrt(10); // ATR-normalised 10-bar move
  const roc5 = (px - c[i - 5].close) / a / Math.sqrt(5);
  const roc5Prev = (c[i - 5].close - c[i - 10].close) / a / Math.sqrt(5);
  const accel = roc5 - roc5Prev;

  const last5 = c.slice(i - 4, i + 1);
  const body = last5.reduce((s, k) => s + (k.close - k.open), 0) / (last5.reduce((s, k) => s + (k.high - k.low), 0) || 1);
  let run = 0;
  for (let j = i; j > i - 8; j--) {
    const dir = Math.sign(c[j].close - c[j].open);
    if (dir === 0 || (run !== 0 && dir !== Math.sign(run))) break;
    run += dir;
  }

  const avgQv = x.qv.slice(i - 20, i).reduce((s, q) => s + q, 0) / 20 || 1;
  const relV = x.qv.slice(i - 2, i + 1).reduce((s, q) => s + q, 0) / 3 / avgQv; // 3-bar smoothing vs 20-bar mean
  const dir = Math.sign(roc) || 0;
  const volumeConfirm = dir * clamp(Math.max(relV - 1, 0) / 1.5); // only above-average volume confirms; thin volume is neutral, never a sign flip

  const comps: MomentumComponent[] = [
    { key: "roc", label: "Rate of change (10)", value: sq(roc * 1.5), weight: W.roc, detail: `${(((px / c[i - 10].close) - 1) * 100).toFixed(2)}%` },
    { key: "accel", label: "Price acceleration", value: sq(accel * 2), weight: W.accel, detail: accel >= 0 ? "speeding up" : "slowing" },
    { key: "rsi", label: "RSI 14", value: clamp((r - 50) / 30), weight: W.rsi, detail: r.toFixed(1) },
    { key: "macd", label: "MACD histogram", value: sq((h / a) * 8), weight: W.macd, detail: h.toPrecision(3) },
    { key: "body", label: "Candle bodies (5)", value: clamp(body * 1.3), weight: W.body, detail: `${(body * 100).toFixed(0)}% of range` },
    { key: "run", label: "Consecutive candles", value: clamp(run / 5), weight: W.run, detail: run === 0 ? "none" : `${Math.abs(run)} ${run > 0 ? "green" : "red"}` },
    { key: "ema", label: "Distance from EMA20", value: sq(((px - e) / a) / 3), weight: W.ema, detail: `${(((px - e) / e) * 100).toFixed(2)}%` },
    { key: "vwap", label: "Distance from VWAP", value: v === null ? 0 : sq(((px - v) / a) / 3), weight: W.vwap, detail: v === null ? "n/a" : `${(((px - v) / v) * 100).toFixed(2)}%` },
    { key: "volume", label: "Volume confirmation", value: volumeConfirm, weight: W.volume, detail: `${relV.toFixed(2)}x avg` },
  ];
  const score = 100 * comps.reduce((s, k) => s + k.value * k.weight, 0);
  return { score, comps };
}

export function computeMomentum(c: Candle[]): MomentumResult | null {
  if (c.length < 60) return null;
  const close = c.map((k) => k.close);
  const ctx: Ctx = {
    c, atr: atr(c, 14), rsi: rsi(close, 14), hist: macd(close).hist, ema20: ema(close, 20),
    vwap: vwap(c, "day"), qv: c.map((k) => k.quoteVolume),
  };
  const i = c.length - 1;
  const now = at(ctx, i), prev = at(ctx, i - 3);
  if (!now || !prev) return null;

  const s = now.score;
  const sign = Math.sign(s) || 1;
  // Direction-adjusted: positive means momentum in the current direction is strengthening.
  const adj = (s - prev.score) * sign;
  const accelerationPct = clamp(adj / Math.max(Math.abs(prev.score), 10), -5, 5) * 100;

  const abs = Math.abs(s);
  const strength: MomentumStrength = abs >= 55 ? "STRONG" : abs >= 25 ? "MODERATE" : "WEAK";
  const trend: MomentumTrend = adj >= 5 ? "ACCELERATING" : adj <= -5 ? "DECELERATING" : "STEADY";
  const direction = abs < 10 ? "NEUTRAL" : s > 0 ? "BULLISH" : "BEARISH";
  return {
    score: s, previousScore: prev.score, accelerationPts: adj, accelerationPct, direction, strength, trend,
    condition: `${strength} / ${trend}`, components: now.comps,
  };
}
