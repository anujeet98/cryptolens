import type { DerivativesSnapshot, OiPoint } from "@/types/market";

export const OI_WINDOWS = [
  { label: "5m", sec: 300 },
  { label: "15m", sec: 900 },
  { label: "1h", sec: 3600 },
  { label: "4h", sec: 14400 },
  { label: "24h", sec: 86400 },
] as const;

export type OiRegime = "NEW_LONGS" | "SHORT_COVERING" | "NEW_SHORTS" | "LONG_CLOSING" | "NEUTRAL";

export interface OiWindow {
  label: string;
  oiChangePct: number | null; // change in contracts (base units), so price moves don't distort it
  priceChangePct: number | null; // implied price = notional / contracts at that time
  regime: OiRegime | null;
}

export interface OiAnalysis {
  oi: number;
  oiUsd: number;
  windows: OiWindow[];
  zScore: number | null;
  zWindowHours: number;
  percentile: number | null;
}

export const REGIME_TEXT: Record<OiRegime, { title: string; text: string }> = {
  NEW_LONGS: { title: "Price ↑ · OI ↑", text: "New leveraged positions entering, likely net new longs." },
  SHORT_COVERING: {
    title: "Price ↑ · OI ↓",
    text: "Likely short covering / short liquidations rather than fresh buying.",
  },
  NEW_SHORTS: { title: "Price ↓ · OI ↑", text: "Likely new shorts entering." },
  LONG_CLOSING: { title: "Price ↓ · OI ↓", text: "Likely longs closing or being liquidated." },
  NEUTRAL: { title: "No clear signal", text: "Price or OI change is too small to interpret." },
};

/** Heuristic only: OI shows positions opened/closed, not which side — the label is a likelihood, not a fact. */
export function interpretOi(priceChangePct: number, oiChangePct: number): OiRegime {
  const priceFlat = Math.abs(priceChangePct) < 0.1,
    oiFlat = Math.abs(oiChangePct) < 0.3;
  if (priceFlat || oiFlat) return "NEUTRAL";
  if (priceChangePct > 0) return oiChangePct > 0 ? "NEW_LONGS" : "SHORT_COVERING";
  return oiChangePct > 0 ? "NEW_SHORTS" : "LONG_CLOSING";
}

function at(hist: OiPoint[], targetSec: number): OiPoint | null {
  let best: OiPoint | null = null;
  for (const p of hist) {
    if (p.time <= targetSec) best = p;
    else break;
  }
  return best;
}

export function analyzeOi(hist: OiPoint[], snap: DerivativesSnapshot): OiAnalysis | null {
  if (hist.length < 12) return null;
  const nowSec = snap.timestamp / 1000;
  const windows: OiWindow[] = OI_WINDOWS.map(({ label, sec }) => {
    const p = at(hist, nowSec - sec);
    if (!p || p.oi <= 0) return { label, oiChangePct: null, priceChangePct: null, regime: null };
    const oiChg = ((snap.openInterest - p.oi) / p.oi) * 100;
    const then = p.oiUsd / p.oi;
    const pxChg = ((snap.markPrice - then) / then) * 100;
    return { label, oiChangePct: oiChg, priceChangePct: pxChg, regime: interpretOi(pxChg, oiChg) };
  });
  const xs = hist.map((p) => p.oi);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return {
    oi: snap.openInterest,
    oiUsd: snap.openInterestUsd,
    windows,
    zScore: sd > 0 ? (snap.openInterest - mean) / sd : null,
    zWindowHours: Math.round((hist[hist.length - 1].time - hist[0].time) / 3600),
    percentile: (xs.filter((v) => v <= snap.openInterest).length / xs.length) * 100,
  };
}
