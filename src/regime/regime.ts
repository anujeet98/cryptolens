import { adx, atr } from "@/indicators";
import { computeMomentum } from "@/analysis/momentum";
import { computeTechnicals } from "@/analysis/technicals";
import { analyzeVolume, type VolumeState } from "@/analysis/volume";
import type { FundingClass } from "@/analysis/funding";
import type { OiRegime } from "@/analysis/openInterest";
import type { Candle, Timeframe } from "@/types/market";

export type TrendRegime = "STRONG_UPTREND" | "UPTREND" | "RANGE" | "DOWNTREND" | "STRONG_DOWNTREND" | "TRANSITION";
export type VolRegime = "SQUEEZE" | "LOW" | "NORMAL" | "HIGH" | "EXTREME";

export interface RegimeFactor { key: string; label: string; vote: number; weight: number; detail: string } // vote in -1..+1

export interface RegimeContext { fundingClass?: FundingClass | null; oiRegime?: OiRegime | null }

export interface Regime {
  trend: TrendRegime;
  stalled: boolean; // trend label holds on ADX but the last 20 bars made almost no net progress
  volatility: VolRegime;
  volTrend: "EXPANDING" | "CONTRACTING" | "STEADY";
  trendScore: number; // -100..+100, weighted vote of all factors
  confidence: number; // 0..100, see confidenceOf
  adx: number;
  plusDI: number;
  minusDI: number;
  efficiency: number; // 0..1, net move / path length over 20 bars
  atrPct: number; // ATR(14) as % of price
  atrPercentile: number; // 0..100 vs the last ~150 bars
  factors: RegimeFactor[];
  notes: string[]; // context that does NOT change the classification
}

// Classification thresholds (ADX is the trend-strength gate; direction comes from the factor vote).
export const ADX_TREND = 25;
export const ADX_STRONG = 40;
export const ADX_RANGE = 20;
const SCORE_TREND = 25;
const SCORE_STRONG = 50;
const ER_RANGE = 0.35;
export const ER_STALL = 0.15; // a random walk averages ~0.18 over 20 bars, so this is at or below chop
const MIN_CANDLES = 80;
const ER_N = 20;

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const last = (s: (number | null)[]) => { for (let i = s.length - 1; i >= 0; i--) if (s[i] !== null) return s[i] as number; return null; };

/** Kaufman efficiency ratio: how directly price travelled. 1 = straight line, ~0 = pure chop. Signed by net direction. */
export function efficiencyRatio(close: number[], n = ER_N): { er: number; dir: number } {
  if (close.length <= n) return { er: 0, dir: 0 };
  const seg = close.slice(-n - 1);
  let path = 0;
  for (let i = 1; i < seg.length; i++) path += Math.abs(seg[i] - seg[i - 1]);
  const net = seg[seg.length - 1] - seg[0];
  return { er: path > 0 ? Math.abs(net) / path : 0, dir: Math.sign(net) };
}

export function percentileRank(x: number, xs: number[]): number {
  return xs.length ? (xs.filter((v) => v <= x).length / xs.length) * 100 : 50;
}

export function volRegimeOf(percentile: number, squeeze: boolean): VolRegime {
  if (squeeze) return "SQUEEZE";
  if (percentile < 20) return "LOW";
  if (percentile < 80) return "NORMAL";
  if (percentile < 95) return "HIGH";
  return "EXTREME";
}

/**
 * Trend label from ADX strength plus the directional vote. Weak or contradictory evidence is TRANSITION, never a forced call.
 * "Strong" also needs recent progress (efficiency): ADX is smoothed and lags, so it stays high after an impulse even once price stalls.
 */
export function trendOf(adxV: number, score: number, er: number): TrendRegime {
  if (adxV >= ADX_TREND && Math.abs(score) >= SCORE_TREND) {
    const strong = adxV >= ADX_STRONG && Math.abs(score) >= SCORE_STRONG && er >= ER_STALL;
    return score > 0 ? (strong ? "STRONG_UPTREND" : "UPTREND") : (strong ? "STRONG_DOWNTREND" : "DOWNTREND");
  }
  if (adxV < ADX_RANGE && er < ER_RANGE) return "RANGE";
  return "TRANSITION";
}

/**
 * Confidence = how decisively the evidence fits the label, not a probability of being right.
 * Trends: half factor agreement, half ADX headroom above the trend gate. Range: half share of unconvinced factors, half ADX headroom below the range gate.
 * Transition is capped low by construction. A stalled trend keeps 60% of its confidence: the label rests on a lagging measure.
 */
export function confidenceOf(trend: TrendRegime, adxV: number, factors: RegimeFactor[], stalled = false): number {
  const total = factors.reduce((s, f) => s + f.weight, 0) || 1;
  if (trend === "TRANSITION") return Math.round(Math.min(40, 100 * (1 - Math.abs(factors.reduce((s, f) => s + f.vote * f.weight, 0) / total))));
  if (trend === "RANGE") {
    const calm = factors.filter((f) => Math.abs(f.vote) < 0.35).reduce((s, f) => s + f.weight, 0) / total;
    return Math.round(100 * (0.5 * calm + 0.5 * clamp((ADX_RANGE - adxV) / 15 + 0.2)));
  }
  const dir = trend.includes("UP") ? 1 : -1;
  const agree = factors.filter((f) => f.vote * dir > 0).reduce((s, f) => s + f.weight, 0) / total;
  return Math.round(100 * (0.5 * agree + 0.5 * clamp((adxV - ADX_RANGE) / 25)) * (stalled ? 0.6 : 1));
}

export function classifyRegime(candles: Candle[], tf: Timeframe, opts: { nowMs?: number; ctx?: RegimeContext } = {}): Regime | null {
  if (candles.length < MIN_CANDLES) return null;
  const close = candles.map((c) => c.close);
  const price = close[close.length - 1];

  const a = adx(candles, 14);
  const adxV = last(a.adx), pDI = last(a.plusDI), mDI = last(a.minusDI);
  const atrS = atr(candles, 14);
  const atrNow = last(atrS);
  if (adxV === null || pDI === null || mDI === null || atrNow === null || !(price > 0)) return null;
  const atrPct = (atrNow / price) * 100;

  const atrPctSeries: number[] = [];
  for (let i = Math.max(0, candles.length - 150); i < candles.length; i++) { const v = atrS[i]; if (v !== null) atrPctSeries.push((v / close[i]) * 100); }
  const atrPercentile = percentileRank(atrPct, atrPctSeries);
  const tenAgo = atrS[candles.length - 11];
  const volTrend = tenAgo === null || tenAgo === undefined ? "STEADY" : atrNow / tenAgo > 1.2 ? "EXPANDING" : atrNow / tenAgo < 0.8 ? "CONTRACTING" : "STEADY";

  const tech = computeTechnicals(candles);
  const mom = computeMomentum(candles);
  const { er, dir: erDir } = efficiencyRatio(close);

  const factors: RegimeFactor[] = [];
  const add = (key: string, label: string, vote: number, weight: number, detail: string) => factors.push({ key, label, vote: clamp(vote, -1, 1), weight, detail });

  add("adx", "ADX / DI", Math.sign(pDI - mDI) * clamp((adxV - 15) / 30), 3, `ADX ${adxV.toFixed(0)}, +DI ${pDI.toFixed(0)} / -DI ${mDI.toFixed(0)}`);
  add("er", "Efficiency", erDir * clamp(er / 0.6), 1.5, `${(er * 100).toFixed(0)}% of the 20-bar path was net progress`);
  if (tech) {
    add("align", "MA alignment", tech.alignment === "BULLISH" ? 1 : tech.alignment === "BEARISH" ? -1 : 0, 2, `EMA stack ${tech.alignment.toLowerCase()}`);
    const e50 = tech.mas.find((m) => m.kind === "EMA" && m.period === 50);
    if (e50?.slopePct != null) add("slope", "EMA50 slope", Math.tanh(e50.slopePct / atrPct), 1.5, `${e50.slopePct >= 0 ? "+" : ""}${e50.slopePct.toFixed(2)}% over 5 bars vs ATR ${atrPct.toFixed(2)}%`);
    const e200 = tech.mas.find((m) => m.kind === "EMA" && m.period === 200);
    if (e200?.distancePct != null) add("e200", "Price vs EMA200", Math.tanh(e200.distancePct / (atrPct * 5)), 1, `${e200.distancePct >= 0 ? "+" : ""}${e200.distancePct.toFixed(2)}% from EMA200`);
    if (tech.macd) add("macd", "MACD", (tech.macd.state === "BULLISH" ? 1 : -1) * (tech.macd.momentum === "WEAKENING" ? 0.5 : 1), 1, `${tech.macd.state.toLowerCase()}, ${tech.macd.momentum.toLowerCase()}`);
  }
  if (mom) add("mom", "Momentum score", mom.score / 100, 1.5, `${mom.score >= 0 ? "+" : ""}${mom.score.toFixed(0)} / 100, ${mom.condition.toLowerCase()}`);

  const wSum = factors.reduce((s, f) => s + f.weight, 0);
  const trendScore = (100 * factors.reduce((s, f) => s + f.vote * f.weight, 0)) / wSum;
  const trend = trendOf(adxV, trendScore, er);
  const volatility = volRegimeOf(atrPercentile, tech?.bollinger?.squeeze ?? false);

  const notes: string[] = [];
  const up = trend.includes("UP"), down = trend.includes("DOWN"), trending = up || down;
  const stalled = trending && er < ER_STALL;
  if (stalled) notes.push(`ADX is still elevated from an earlier move, but the last ${ER_N} bars made almost no net progress: the ${up ? "uptrend" : "downtrend"} is pausing, not accelerating.`);
  const vol = analyzeVolume(candles, tf, opts.nowMs ?? Date.now());
  const vs: VolumeState | null = vol?.state ?? null;
  if (trending && vs === "CONTRACTION") notes.push("The trend is running on contracting volume: less participation behind the move.");
  if (trending && vs === "CLIMAX") notes.push("Volume climax inside a trend: can mark exhaustion or acceleration; wait for follow-through.");
  if (trend === "RANGE" && volatility === "SQUEEZE") notes.push("The range is compressing: a breakout is more likely, but its direction is not known.");
  if (trend === "RANGE" && volTrend === "EXPANDING") notes.push("Range with rising volatility: expect false breaks.");
  if (volatility === "EXTREME") notes.push("Volatility is in the top 5% of recent history: stops and position sizing need extra room.");
  const f = opts.ctx?.fundingClass, o = opts.ctx?.oiRegime;
  if (up && f === "EXTREMELY_POSITIVE") notes.push("Funding is extremely positive: longs are crowded, so the uptrend is vulnerable to sharp flushes.");
  if (down && f === "EXTREMELY_NEGATIVE") notes.push("Funding is extremely negative: shorts are crowded, so the downtrend is vulnerable to squeezes.");
  if (up && f === "EXTREMELY_NEGATIVE") notes.push("Uptrend against extremely negative funding: shorts are paying to stay in, which is squeeze fuel.");
  if (down && f === "EXTREMELY_POSITIVE") notes.push("Downtrend against extremely positive funding: longs are paying to stay in, which is flush fuel.");
  if (up && o === "NEW_LONGS") notes.push("Rising open interest with rising price: new positions support the uptrend.");
  if (up && o === "SHORT_COVERING") notes.push("The rise looks like short covering (OI falling), which is usually a weaker driver than new buying.");
  if (down && o === "NEW_SHORTS") notes.push("Rising open interest with falling price: new shorts support the downtrend.");
  if (down && o === "LONG_CLOSING") notes.push("The decline looks like longs closing (OI falling), which usually fades once the forced exits are done.");

  return {
    trend, stalled, volatility, volTrend, trendScore, confidence: confidenceOf(trend, adxV, factors, stalled),
    adx: adxV, plusDI: pDI, minusDI: mDI, efficiency: er, atrPct, atrPercentile, factors, notes,
  };
}

export interface MtfAlignment { label: string; up: number; down: number; range: number; total: number }

/** Summarise how many timeframes agree. TRANSITION counts toward the total but toward no side. */
export function mtfAlignment(regimes: (TrendRegime | null | undefined)[]): MtfAlignment | null {
  const rs = regimes.filter((r): r is TrendRegime => !!r);
  if (!rs.length) return null;
  const up = rs.filter((r) => r.includes("UP")).length;
  const down = rs.filter((r) => r.includes("DOWN")).length;
  const range = rs.filter((r) => r === "RANGE").length;
  const total = rs.length;
  const label = up === total ? "All timeframes trending up" : down === total ? "All timeframes trending down"
    : up > 0 && down > 0 ? "Timeframes conflict: trends point both ways"
    : up > 0 ? `${up} of ${total} timeframes trending up` : down > 0 ? `${down} of ${total} timeframes trending down`
    : range === total ? "All timeframes ranging" : "No timeframe shows a clear trend";
  return { label, up, down, range, total };
}
