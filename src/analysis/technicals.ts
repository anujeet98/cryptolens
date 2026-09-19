import { bollinger, crossIndex, divergences, ema, failureSwing, macd, rsi, sma, vwap, type Divergence, type Series } from "@/indicators";
import type { Candle } from "@/types/market";

export const MA_PERIODS = [9, 20, 50, 100, 200] as const;

export interface MaState {
  kind: "SMA" | "EMA";
  period: number;
  value: number | null;
  priceAbove: boolean | null;
  distancePct: number | null;
  slopePct: number | null; // % change of the MA over the last 5 bars
}

export type RsiZone = "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL";
export type MacdState = "BULLISH" | "BEARISH";
export type MacdMomentum = "STRENGTHENING" | "WEAKENING";

export interface Technicals {
  price: number;
  mas: MaState[];
  alignment: "BULLISH" | "BEARISH" | "MIXED";
  crosses: { pair: string; dir: "up" | "down"; barsAgo: number }[];
  rsi14: number | null;
  rsi7: number | null;
  rsiZone: RsiZone;
  rsiNote: string | null;
  rsiDivergences: Divergence[];
  rsiFailureSwing: "bullish" | "bearish" | null;
  macd: {
    macd: number; signal: number; hist: number;
    state: MacdState;
    momentum: MacdMomentum;
    histAccel: number; // hist[last] - hist[last-1]
    cross: { dir: "up" | "down"; barsAgo: number } | null;
    divergences: Divergence[];
  } | null;
  bollinger: {
    upper: number; mid: number; lower: number; bandwidth: number; percentB: number;
    volatility: "EXPANDING" | "CONTRACTING" | "NORMAL";
    squeeze: boolean;
    walking: "upper" | "lower" | null;
  } | null;
  vwap: { day: number | null; week: number | null; dayPosition: "above" | "below" | null; event: "reclaim" | "rejection" | null };
}

const last = (s: Series): number | null => (s.length ? s[s.length - 1] : null);

function maState(kind: "SMA" | "EMA", period: number, s: Series, price: number): MaState {
  const v = last(s);
  const prev = s.length > 5 ? s[s.length - 6] : null;
  return {
    kind, period, value: v,
    priceAbove: v === null ? null : price > v,
    distancePct: v === null ? null : ((price - v) / v) * 100,
    slopePct: v === null || prev === null ? null : ((v - prev) / prev) * 100,
  };
}

/** Pure function of candle history: no exchange data, no side effects. */
export function computeTechnicals(c: Candle[]): Technicals | null {
  if (c.length < 30) return null;
  const close = c.map((x) => x.close);
  const price = close[close.length - 1];

  const smas = MA_PERIODS.filter((p) => p >= 20).map((p) => [p, sma(close, p)] as const);
  const emas = MA_PERIODS.map((p) => [p, ema(close, p)] as const);
  const mas = [...smas.map(([p, s]) => maState("SMA", p, s, price)), ...emas.map(([p, s]) => maState("EMA", p, s, price))];

  const e = Object.fromEntries(emas) as Record<number, Series>;
  const e20 = last(e[20]), e50 = last(e[50]), e200 = last(e[200]);
  let alignment: Technicals["alignment"] = "MIXED";
  if (e20 !== null && e50 !== null) {
    const chain = e200 !== null ? [e20, e50, e200] : [e20, e50];
    if (chain.every((v, i) => i === 0 || chain[i - 1] > v)) alignment = "BULLISH";
    else if (chain.every((v, i) => i === 0 || chain[i - 1] < v)) alignment = "BEARISH";
  }

  const crosses: Technicals["crosses"] = [];
  for (const [a, b] of [[9, 20], [20, 50], [50, 200]] as const) {
    const x = crossIndex(e[a], e[b], 20);
    if (x) crosses.push({ pair: `EMA${a}/EMA${b}`, dir: x.dir, barsAgo: c.length - 1 - x.index });
  }

  const r14 = rsi(close, 14), r7 = rsi(close, 7);
  const rv = last(r14);
  const rsiZone: RsiZone = rv === null ? "NEUTRAL" : rv >= 70 ? "OVERBOUGHT" : rv <= 30 ? "OVERSOLD" : "NEUTRAL";
  const rsiNote =
    rsiZone === "OVERBOUGHT" ? "Overbought ≠ immediate reversal — strong trends can stay overbought for a long time."
    : rsiZone === "OVERSOLD" ? "Oversold ≠ immediate bounce — strong downtrends can stay oversold for a long time."
    : null;

  const m = macd(close);
  const h = m.hist, n = h.length;
  let macdOut: Technicals["macd"] = null;
  if (h[n - 1] !== null && h[n - 2] !== null) {
    const hv = h[n - 1]!, hp = h[n - 2]!;
    const x = crossIndex(m.macd, m.signal, 10);
    macdOut = {
      macd: m.macd[n - 1]!, signal: m.signal[n - 1]!, hist: hv,
      state: hv >= 0 ? "BULLISH" : "BEARISH",
      momentum: Math.abs(hv) >= Math.abs(hp) ? "STRENGTHENING" : "WEAKENING",
      histAccel: hv - hp,
      cross: x ? { dir: x.dir, barsAgo: n - 1 - x.index } : null,
      divergences: divergences(c, m.hist),
    };
  }

  const bb = bollinger(close, 20, 2);
  let bbOut: Technicals["bollinger"] = null;
  const bw = bb.bandwidth, pb = bb.percentB;
  if (bw[bw.length - 1] !== null) {
    const recent = bw.slice(-120).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const cur = bw[bw.length - 1]!;
    const rank = recent.filter((x) => x <= cur).length / recent.length;
    const prev = bw[bw.length - 6];
    const tail = pb.slice(-4);
    bbOut = {
      upper: last(bb.upper)!, mid: last(bb.mid)!, lower: last(bb.lower)!, bandwidth: cur, percentB: pb[pb.length - 1]!,
      volatility: prev !== null && cur > prev * 1.15 ? "EXPANDING" : prev !== null && cur < prev * 0.87 ? "CONTRACTING" : "NORMAL",
      squeeze: recent.length >= 50 && rank <= 0.1,
      walking: tail.length === 4 && tail.every((x) => x !== null && x > 0.95) ? "upper" : tail.length === 4 && tail.every((x) => x !== null && x < 0.05) ? "lower" : null,
    };
  }

  const vd = vwap(c, "day"), vw = vwap(c, "week");
  const vdv = last(vd);
  let event: Technicals["vwap"]["event"] = null;
  if (vdv !== null && c.length > 3) {
    const wasBelow = c.slice(-4, -1).some((x, i) => x.close < (vd[vd.length - 4 + i] ?? Infinity));
    const wasAbove = c.slice(-4, -1).some((x, i) => x.close > (vd[vd.length - 4 + i] ?? -Infinity));
    if (price > vdv && wasBelow) event = "reclaim";
    else if (price < vdv && wasAbove) event = "rejection";
  }

  return {
    price, mas, alignment, crosses,
    rsi14: rv, rsi7: last(r7), rsiZone, rsiNote,
    rsiDivergences: divergences(c, r14),
    rsiFailureSwing: failureSwing(r14),
    macd: macdOut,
    bollinger: bbOut,
    vwap: { day: vdv, week: last(vw), dayPosition: vdv === null ? null : price > vdv ? "above" : "below", event },
  };
}
