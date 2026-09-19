import type { FundingPoint } from "@/types/market";

export type FundingClass = "EXTREMELY_NEGATIVE" | "NEGATIVE" | "NEUTRAL" | "POSITIVE" | "EXTREMELY_POSITIVE";

export interface FundingAnalysis {
  rate: number; // per funding interval
  rate8h: number; // normalised to an 8h interval so symbols with 1h/4h funding are comparable
  intervalHours: number;
  annualizedPct: number;
  previous: number | null;
  change: number | null;
  percentile7d: number | null; // 0..100, rank of |current| context: share of samples <= current
  percentile30d: number | null;
  samples7d: number;
  samples30d: number;
  class: FundingClass;
}

export const FUNDING_LABEL: Record<FundingClass, string> = {
  EXTREMELY_NEGATIVE: "Extremely negative", NEGATIVE: "Negative", NEUTRAL: "Neutral", POSITIVE: "Positive", EXTREMELY_POSITIVE: "Extremely positive",
};

/** Funding interval inferred from spacing of recent history (Binance uses 8h, 4h or 1h depending on symbol). */
export function fundingIntervalHours(h: FundingPoint[]): number {
  const d: number[] = [];
  for (let i = Math.max(1, h.length - 10); i < h.length; i++) d.push((h[i].time - h[i - 1].time) / 3600);
  if (!d.length) return 8;
  d.sort((a, b) => a - b);
  const m = d[Math.floor(d.length / 2)];
  return m >= 0.5 ? Math.round(m) : 8;
}

function percentileOf(x: number, xs: number[]): number | null {
  if (xs.length < 5) return null;
  return (xs.filter((v) => v <= x).length / xs.length) * 100;
}

/** Baseline funding is +0.01%/8h. Thresholds are absolute (8h-equivalent), then tightened by percentile when history allows. */
export function classifyFunding(rate8h: number, pct30: number | null): FundingClass {
  const bp = rate8h * 10_000; // basis points per 8h
  let c: FundingClass =
    bp >= 10 ? "EXTREMELY_POSITIVE" : bp >= 3 ? "POSITIVE" : bp <= -10 ? "EXTREMELY_NEGATIVE" : bp <= -3 ? "NEGATIVE" : "NEUTRAL";
  // Historically extreme relative to this symbol's own last 30d, and meaningfully away from baseline.
  if (pct30 !== null && c !== "EXTREMELY_POSITIVE" && bp >= 2 && pct30 >= 97) c = "EXTREMELY_POSITIVE";
  if (pct30 !== null && c !== "EXTREMELY_NEGATIVE" && bp <= -2 && pct30 <= 3) c = "EXTREMELY_NEGATIVE";
  return c;
}

export function analyzeFunding(history: FundingPoint[], currentRate: number, nowSec = Date.now() / 1000): FundingAnalysis {
  const interval = fundingIntervalHours(history);
  const to8 = (r: number) => (r * 8) / interval;
  const within = (days: number) => history.filter((p) => p.time >= nowSec - days * 86400).map((p) => to8(p.rate));
  const w7 = within(7), w30 = within(30);
  const rate8h = to8(currentRate);
  const p30 = percentileOf(rate8h, w30);
  const prev = history.length ? history[history.length - 1].rate : null;
  return {
    rate: currentRate, rate8h, intervalHours: interval,
    annualizedPct: currentRate * (24 / interval) * 365 * 100,
    previous: prev, change: prev === null ? null : currentRate - prev,
    percentile7d: percentileOf(rate8h, w7), percentile30d: p30,
    samples7d: w7.length, samples30d: w30.length,
    class: classifyFunding(rate8h, p30),
  };
}

/** Funding is context, never a standalone signal — combine with the direction of price. */
export function fundingContext(cls: FundingClass, priceChangePct: number): string | null {
  const up = priceChangePct > 0.3, down = priceChangePct < -0.3;
  if (up && cls === "EXTREMELY_NEGATIVE") return "Price rising while funding is very negative: shorts may be crowded — consistent with squeeze risk.";
  if (up && cls === "EXTREMELY_POSITIVE") return "Price rising with very positive funding: longs look crowded — the move may be fragile.";
  if (down && cls === "EXTREMELY_POSITIVE") return "Price falling while funding is very positive: longs may be trapped.";
  if (down && cls === "EXTREMELY_NEGATIVE") return "Price falling with very negative funding: shorts are crowded — bounce/squeeze risk if selling stalls.";
  if (cls === "EXTREMELY_POSITIVE" || cls === "EXTREMELY_NEGATIVE") return "Funding is extreme, but funding alone is not a reversal signal.";
  return null;
}
