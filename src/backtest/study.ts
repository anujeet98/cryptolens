import type { Candle } from "@/types/market";

/**
 * A signal sees ONLY candles up to and including bar i (a window ending at i). It returns a label, or null for "no opinion".
 * The study enters at the OPEN of the next bar, so a label can never use information from the bar it is traded on.
 */
export type SignalFn = (window: Candle[]) => string | null;

/** What to measure after each label: the signed forward return, or the forward high-low range (how much price moved, either way). */
export type Measure = "return" | "range";

export interface StudyOptions {
  horizons: number[]; // forward horizons in bars
  measure?: Measure; // default "return"
  window?: number; // candles handed to the signal (default 300, what the live dashboard uses)
  warmup?: number; // first bar index that may emit a label (default = window)
}

export interface Stat {
  n: number; // labelled bars
  nEff: number; // n / horizon: forward windows overlap, so this is the honest sample size
  mean: number; // mean forward return, fraction
  median: number;
  std: number;
  hitRate: number; // share of forward returns > 0
  excess: number; // mean minus the unconditional mean over all bars at the same horizon
  t: number | null; // excess / (std / sqrt(nEff)); null when nEff < 2
  reliable: boolean; // nEff >= MIN_EFF
}

export interface StudyResult {
  bars: number;
  labelled: number;
  horizons: number[];
  baseline: Record<number, { n: number; mean: number; std: number; hitRate: number }>; // all bars, per horizon
  byLabel: Record<string, Record<number, Stat>>;
}

export const MIN_EFF = 30;

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

/** Forward return entering at open[i+1], exiting at close[i+h]. null if the history ends first. */
export function forwardReturn(c: Candle[], i: number, h: number): number | null {
  if (i + h >= c.length) return null;
  return c[i + h].close / c[i + 1].open - 1;
}

/** Range of the next h bars (highest high minus lowest low) relative to the entry open. Direction-free, so it tests "how much" not "which way". */
export function forwardRange(c: Candle[], i: number, h: number): number | null {
  if (i + h >= c.length) return null;
  let hi = -Infinity, lo = Infinity;
  for (let k = i + 1; k <= i + h; k++) { hi = Math.max(hi, c[k].high); lo = Math.min(lo, c[k].low); }
  return (hi - lo) / c[i + 1].open;
}

/** Walk forward through history, label every bar using only past data, then measure what happened next. */
export function runStudy(candles: Candle[], signal: SignalFn, opts: StudyOptions): StudyResult {
  const W = opts.window ?? 300;
  const warm = Math.max(opts.warmup ?? W, 1);
  const hs = opts.horizons;
  const measure = opts.measure === "range" ? forwardRange : forwardReturn;
  const fwd: Record<number, number[]> = Object.fromEntries(hs.map((h) => [h, []]));
  const groups = new Map<string, Record<number, number[]>>();
  let labelled = 0;

  for (let i = warm - 1; i < candles.length - 1; i++) {
    const label = signal(candles.slice(Math.max(0, i - W + 1), i + 1));
    for (const h of hs) {
      const r = measure(candles, i, h);
      if (r === null) continue;
      fwd[h].push(r);
      if (label !== null) {
        let g = groups.get(label);
        if (!g) { g = Object.fromEntries(hs.map((x) => [x, [] as number[]])); groups.set(label, g); }
        g[h].push(r);
      }
    }
    if (label !== null) labelled++;
  }

  const baseline: StudyResult["baseline"] = {};
  for (const h of hs) baseline[h] = { n: fwd[h].length, mean: mean(fwd[h]), std: std(fwd[h]), hitRate: fwd[h].length ? fwd[h].filter((x) => x > 0).length / fwd[h].length : 0 };

  const byLabel: StudyResult["byLabel"] = {};
  for (const [label, g] of groups) {
    byLabel[label] = {};
    for (const h of hs) {
      const xs = g[h];
      const n = xs.length, nEff = n / h, m = mean(xs), sd = std(xs);
      const excess = m - baseline[h].mean;
      byLabel[label][h] = {
        n, nEff, mean: m, median: median(xs), std: sd, hitRate: n ? xs.filter((x) => x > 0).length / n : 0,
        excess, t: nEff >= 2 && sd > 0 ? excess / (sd / Math.sqrt(nEff)) : null, reliable: nEff >= MIN_EFF,
      };
    }
  }
  return { bars: candles.length, labelled, horizons: hs, baseline, byLabel };
}
