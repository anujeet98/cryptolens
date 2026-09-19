import type { Candle } from "@/types/market";

/** Every indicator returns an array aligned 1:1 with its input; `null` = not enough data yet. */
export type Series = (number | null)[];

export function sma(v: number[], n: number): Series {
  const out: Series = new Array(v.length).fill(null);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** EMA seeded with the SMA of the first n values (standard TradingView/TA-Lib convention). */
export function ema(v: number[], n: number): Series {
  const out: Series = new Array(v.length).fill(null);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let prev = v.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < v.length; i++) {
    prev = v[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(v: number[], n = 14): Series {
  const out: Series = new Array(v.length).fill(null);
  if (v.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = v[i] - v[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  const calc = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = calc();
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = calc();
  }
  return out;
}

export interface Macd { macd: Series; signal: Series; hist: Series }

export function macd(v: number[], fast = 12, slow = 26, sig = 9): Macd {
  const f = ema(v, fast), s = ema(v, slow);
  const line: Series = v.map((_, i) => (f[i] !== null && s[i] !== null ? f[i]! - s[i]! : null));
  const start = line.findIndex((x) => x !== null);
  const signal: Series = new Array(v.length).fill(null);
  if (start >= 0) {
    const e = ema(line.slice(start) as number[], sig);
    e.forEach((x, i) => (signal[start + i] = x));
  }
  const hist: Series = line.map((x, i) => (x !== null && signal[i] !== null ? x - signal[i]! : null));
  return { macd: line, signal, hist };
}

export interface Bollinger { upper: Series; mid: Series; lower: Series; bandwidth: Series; percentB: Series }

/** Population standard deviation, matching TradingView's default. */
export function bollinger(v: number[], n = 20, k = 2): Bollinger {
  const mid = sma(v, n);
  const upper: Series = [], lower: Series = [], bandwidth: Series = [], percentB: Series = [];
  for (let i = 0; i < v.length; i++) {
    const m = mid[i];
    if (m === null) { upper.push(null); lower.push(null); bandwidth.push(null); percentB.push(null); continue; }
    let ss = 0;
    for (let j = i - n + 1; j <= i; j++) ss += (v[j] - m) ** 2;
    const sd = Math.sqrt(ss / n);
    const u = m + k * sd, l = m - k * sd;
    upper.push(u); lower.push(l);
    bandwidth.push(m === 0 ? null : (u - l) / m);
    percentB.push(u === l ? 0.5 : (v[i] - l) / (u - l));
  }
  return { upper, mid, lower, bandwidth, percentB };
}

/** Anchored VWAP on typical price (H+L+C)/3, resetting each UTC day or ISO week (Mon 00:00 UTC). */
export function vwap(c: Candle[], anchor: "day" | "week"): Series {
  const out: Series = [];
  let pv = 0, vol = 0, key = -1;
  for (const x of c) {
    const d = Math.floor(x.time / 86400);
    const k = anchor === "day" ? d : Math.floor((d + 3) / 7); // 1970-01-01 is a Thursday
    if (k !== key) { key = k; pv = 0; vol = 0; }
    pv += ((x.high + x.low + x.close) / 3) * x.volume;
    vol += x.volume;
    out.push(vol > 0 ? pv / vol : null);
  }
  return out;
}

export interface Pivot { index: number; price: number }

/** A pivot needs `right` later bars to confirm, so the most recent `right` bars never have pivots (no look-ahead). */
export function pivots(values: (number | null)[], left: number, right: number, kind: "high" | "low"): Pivot[] {
  const out: Pivot[] = [];
  for (let i = left; i < values.length - right; i++) {
    const p = values[i];
    if (p === null) continue;
    let ok = true;
    for (let j = i - left; j <= i + right && ok; j++) {
      const q = values[j];
      if (j === i || q === null) { if (q === null) ok = false; continue; }
      if (kind === "high" ? q > p : q < p) ok = false;
      // strictly-equal neighbours: keep only the first to avoid duplicate pivots
      if (q === p && j < i) ok = false;
    }
    if (ok) out.push({ index: i, price: p });
  }
  return out;
}

export function crossIndex(a: Series, b: Series, lookback: number): { index: number; dir: "up" | "down" } | null {
  for (let i = a.length - 1; i > Math.max(0, a.length - 1 - lookback); i--) {
    const a1 = a[i], b1 = b[i], a0 = a[i - 1], b0 = b[i - 1];
    if (a1 === null || b1 === null || a0 === null || b0 === null) continue;
    if (a0 <= b0 && a1 > b1) return { index: i, dir: "up" };
    if (a0 >= b0 && a1 < b1) return { index: i, dir: "down" };
  }
  return null;
}

export type DivergenceKind = "bullish" | "bearish" | "hidden-bullish" | "hidden-bearish";
export interface Divergence { kind: DivergenceKind; barsAgo: number; priceFrom: number; priceTo: number; oscFrom: number; oscTo: number }

/** Compares the two most recent confirmed swing points of price against the oscillator at those same bars. */
export function divergences(c: Candle[], osc: Series, left = 3, right = 3, maxAge = 40): Divergence[] {
  const out: Divergence[] = [];
  const last = c.length - 1;
  const check = (kind: "high" | "low") => {
    const pv = pivots(c.map((x) => (kind === "high" ? x.high : x.low)), left, right, kind).filter((p) => osc[p.index] !== null);
    if (pv.length < 2) return;
    const a = pv[pv.length - 2], b = pv[pv.length - 1];
    if (last - b.index > maxAge) return;
    const oa = osc[a.index]!, ob = osc[b.index]!;
    const base = { barsAgo: last - b.index, priceFrom: a.price, priceTo: b.price, oscFrom: oa, oscTo: ob };
    if (kind === "high") {
      if (b.price > a.price && ob < oa) out.push({ kind: "bearish", ...base });
      else if (b.price < a.price && ob > oa) out.push({ kind: "hidden-bearish", ...base });
    } else {
      if (b.price < a.price && ob > oa) out.push({ kind: "bullish", ...base });
      else if (b.price > a.price && ob < oa) out.push({ kind: "hidden-bullish", ...base });
    }
  };
  check("high");
  check("low");
  return out;
}

/** RSI failure swing: peak beyond the extreme, pullback, lower peak that fails to re-reach the extreme, then break of the pullback. */
export function failureSwing(r: Series, hi = 70, lo = 30, maxAge = 30): "bearish" | "bullish" | null {
  const last = r.length - 1;
  const cur = r[last];
  if (cur === null) return null;
  const hp = pivots(r, 2, 2, "high"), lp = pivots(r, 2, 2, "low");
  if (hp.length >= 2 && lp.length) {
    const [p1, p2] = hp.slice(-2);
    const valley = lp.filter((l) => l.index > p1.index && l.index < p2.index).pop();
    if (valley && p1.price > hi && p2.price < p1.price && cur < valley.price && last - p2.index <= maxAge) return "bearish";
  }
  if (lp.length >= 2 && hp.length) {
    const [v1, v2] = lp.slice(-2);
    const peak = hp.filter((h) => h.index > v1.index && h.index < v2.index).pop();
    if (peak && v1.price < lo && v2.price > v1.price && cur > peak.price && last - v2.index <= maxAge) return "bullish";
  }
  return null;
}

/** Wilder's Average True Range. */
export function atr(c: Candle[], n = 14): Series {
  const out: Series = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close))));
  let prev = tr.slice(1, n + 1).reduce((a, b) => a + b, 0) / n;
  out[n] = prev;
  for (let i = n + 1; i < c.length; i++) {
    prev = (prev * (n - 1) + tr[i]) / n;
    out[i] = prev;
  }
  return out;
}

export interface Adx { adx: Series; plusDI: Series; minusDI: Series }

/** Wilder's ADX with +DI/-DI. First ADX value lands at index 2n-1; earlier entries are null. */
export function adx(c: Candle[], n = 14): Adx {
  const len = c.length;
  const out: Adx = { adx: new Array(len).fill(null), plusDI: new Array(len).fill(null), minusDI: new Array(len).fill(null) };
  if (len < 2 * n) return out;
  const tr: number[] = [0], pdm: number[] = [0], mdm: number[] = [0];
  for (let i = 1; i < len; i++) {
    const up = c[i].high - c[i - 1].high, down = c[i - 1].low - c[i].low;
    tr.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
    pdm.push(up > down && up > 0 ? up : 0);
    mdm.push(down > up && down > 0 ? down : 0);
  }
  let sTr = 0, sP = 0, sM = 0;
  for (let i = 1; i <= n; i++) { sTr += tr[i]; sP += pdm[i]; sM += mdm[i]; }
  const dx: number[] = [];
  let prevAdx: number | null = null;
  for (let i = n; i < len; i++) {
    if (i > n) { sTr = sTr - sTr / n + tr[i]; sP = sP - sP / n + pdm[i]; sM = sM - sM / n + mdm[i]; }
    const p = sTr > 0 ? (100 * sP) / sTr : 0, m = sTr > 0 ? (100 * sM) / sTr : 0;
    out.plusDI[i] = p; out.minusDI[i] = m;
    const d = p + m > 0 ? (100 * Math.abs(p - m)) / (p + m) : 0;
    if (prevAdx === null) {
      dx.push(d);
      if (dx.length === n) { prevAdx = dx.reduce((a, b) => a + b, 0) / n; out.adx[i] = prevAdx; }
    } else {
      prevAdx = (prevAdx * (n - 1) + d) / n;
      out.adx[i] = prevAdx;
    }
  }
  return out;
}
