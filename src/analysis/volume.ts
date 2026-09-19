import type { Candle, Timeframe } from "@/types/market";

export const TF_SECONDS: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400 };

export type VolumeState = "EXPANSION" | "CONTRACTION" | "CLIMAX" | "NORMAL";
export type PriceVolume = "HEALTHY_RALLY" | "WEAKENING_RALLY" | "STRONG_SELLING" | "SELLING_FADING" | "FLAT";

export interface VolumeAnalysis {
  currentBase: number;
  currentQuote: number;
  avgQuote: number; // mean of the previous 20 closed candles
  relativeVolume: number; // current (partial) candle vs average
  projectedRelative: number | null; // time-adjusted, only once >=30% of the candle has elapsed
  lastClosedRelative: number;
  candleProgress: number; // 0..1
  effectiveRelative: number; // used for state detection
  state: VolumeState;
  priceVolume: PriceVolume;
  priceChangePct: number; // over the last 10 bars
  volumeChangePct: number; // last 5 bars vs previous 5
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

/** Volume is analysed in quote currency (USD-ish) so windows are comparable across price levels. */
export function analyzeVolume(c: Candle[], tf: Timeframe, nowMs = Date.now(), lookback = 20): VolumeAnalysis | null {
  if (c.length < lookback + 12) return null;
  const cur = c[c.length - 1];
  const prev = c.slice(-1 - lookback, -1);
  const avg = mean(prev.map((x) => x.quoteVolume));
  if (avg <= 0) return null;

  const dur = TF_SECONDS[tf];
  const progress = cur.closed ? 1 : Math.min(1, Math.max(0, (nowMs / 1000 - cur.time) / dur));
  const rel = cur.quoteVolume / avg;
  const projected = progress >= 0.3 && progress < 1 ? rel / progress : null;
  const lastClosed = c.filter((x) => x.closed).at(-1) ?? cur;
  const lastClosedRel = lastClosed.quoteVolume / avg;
  const eff = progress >= 1 ? rel : projected ?? lastClosedRel;

  // Climax: extreme volume on a wide-range candle that closes off its extreme.
  const ref = progress >= 0.3 || cur.closed ? cur : lastClosed;
  const range = ref.high - ref.low;
  const wide = range > 0 && Math.abs(ref.close - ref.open) / range < 0.6; // wick-heavy: closed well off its extreme
  const atrLike = mean(prev.slice(-14).map((x) => x.high - x.low));
  const bigRange = range > 1.5 * atrLike;
  const state: VolumeState = eff >= 3 && bigRange && wide ? "CLIMAX" : eff >= 1.5 ? "EXPANSION" : eff <= 0.6 ? "CONTRACTION" : "NORMAL";

  // Price vs volume over the last 10 closed-ish bars.
  const w = c.slice(-11);
  const priceChangePct = ((w[w.length - 1].close - w[0].close) / w[0].close) * 100;
  const v1 = mean(c.slice(-5).map((x) => x.quoteVolume));
  const v0 = mean(c.slice(-10, -5).map((x) => x.quoteVolume));
  const volumeChangePct = v0 > 0 ? ((v1 - v0) / v0) * 100 : 0;

  const priceMove = Math.abs(priceChangePct) >= 0.15;
  const volUp = volumeChangePct >= 10, volDown = volumeChangePct <= -10;
  let priceVolume: PriceVolume = "FLAT";
  if (priceMove && priceChangePct > 0) priceVolume = volDown ? "WEAKENING_RALLY" : "HEALTHY_RALLY";
  else if (priceMove && priceChangePct < 0) priceVolume = volDown ? "SELLING_FADING" : volUp ? "STRONG_SELLING" : "FLAT";
  if (priceMove && priceChangePct > 0 && !volUp && !volDown) priceVolume = "HEALTHY_RALLY";

  return {
    currentBase: cur.volume, currentQuote: cur.quoteVolume, avgQuote: avg,
    relativeVolume: rel, projectedRelative: projected, lastClosedRelative: lastClosedRel,
    candleProgress: progress, effectiveRelative: eff, state, priceVolume, priceChangePct, volumeChangePct,
  };
}

export const PRICE_VOLUME_TEXT: Record<PriceVolume, string> = {
  HEALTHY_RALLY: "Price ↑ with volume holding/rising — consistent with healthy momentum.",
  WEAKENING_RALLY: "Price ↑ on falling volume — momentum may be weakening.",
  STRONG_SELLING: "Price ↓ with rising volume — consistent with strong selling pressure.",
  SELLING_FADING: "Price ↓ on falling volume — selling pressure may be fading.",
  FLAT: "No decisive price move over the last 10 bars.",
};

export interface VolumeWindow { label: string; quote: number; prevQuote: number | null; ratio: number | null }

/** Rolling windows from 1m candles; each window is compared to the immediately preceding window of equal length. */
export function volumeWindows(oneMin: Candle[]): VolumeWindow[] {
  const sum = (a: Candle[]) => a.reduce((s, x) => s + x.quoteVolume, 0);
  return ([[5, "5m"], [15, "15m"], [60, "1h"], [240, "4h"]] as const).map(([n, label]) => {
    const cur = oneMin.slice(-n);
    const prevSlice = oneMin.slice(-2 * n, -n);
    const prev = prevSlice.length === n ? sum(prevSlice) : null;
    const q = sum(cur);
    return { label, quote: q, prevQuote: prev, ratio: prev && prev > 0 ? q / prev : null };
  });
}

