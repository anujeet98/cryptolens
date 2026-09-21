import { describe, expect, it } from "vitest";
import {
  classifyRegime,
  confidenceOf,
  efficiencyRatio,
  mtfAlignment,
  percentileRank,
  trendOf,
  volRegimeOf,
} from "./regime";
import type { Candle } from "@/types/market";

const NOW = 1_700_000_000_000;
/** Deterministic candles from a close function. Range per bar = `rng` of price; volume constant. */
const make = (f: (i: number) => number, n = 300, rng = 0.002, vol: (i: number) => number = () => 1000): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = f(i),
      o = i ? f(i - 1) : c;
    return {
      time: NOW / 1000 - (n - i) * 900,
      open: o,
      high: Math.max(o, c) * (1 + rng / 2),
      low: Math.min(o, c) * (1 - rng / 2),
      close: c,
      volume: vol(i),
      quoteVolume: vol(i) * c,
      closed: true,
    };
  });
const wobble = (i: number) => 1 + 0.0008 * Math.sin(i * 1.7); // small deterministic noise so bars are not perfectly regular

describe("classifyRegime", () => {
  it("returns null with too little data", () => {
    expect(
      classifyRegime(
        make((i) => 100 + i, 60),
        "15m",
        { nowMs: NOW },
      ),
    ).toBeNull();
  });

  it("calls a steady climb an uptrend with high confidence and an agreeing factor set", () => {
    const r = classifyRegime(
      make((i) => 100 * 1.003 ** i * wobble(i)),
      "15m",
      { nowMs: NOW },
    )!;
    expect(r.trend === "UPTREND" || r.trend === "STRONG_UPTREND").toBe(true);
    expect(r.trendScore).toBeGreaterThan(40);
    expect(r.confidence).toBeGreaterThan(60);
    expect(r.plusDI).toBeGreaterThan(r.minusDI);
    expect(r.factors.every((f) => f.vote >= -0.01)).toBe(true); // nothing meaningfully votes against a clean trend
  });

  it("mirrors for a steady decline", () => {
    const r = classifyRegime(
      make((i) => 100 * 0.997 ** i * wobble(i)),
      "15m",
      { nowMs: NOW },
    )!;
    expect(r.trend === "DOWNTREND" || r.trend === "STRONG_DOWNTREND").toBe(true);
    expect(r.trendScore).toBeLessThan(-40);
    expect(r.confidence).toBeGreaterThan(60);
  });

  it("calls a sideways oscillation a range", () => {
    const r = classifyRegime(
      make((i) => 100 + 1.5 * Math.sin(i / 2.2)),
      "15m",
      { nowMs: NOW },
    )!;
    expect(r.trend).toBe("RANGE");
    expect(r.adx).toBeLessThan(25);
    expect(Math.abs(r.trendScore)).toBeLessThan(40);
  });

  it("flags a volatility blow-off in the last bars as high or extreme", () => {
    const calm = make((i) => 100 + Math.sin(i / 3), 300, 0.002);
    const wild = calm.map((c, i) => (i >= 290 ? { ...c, high: c.high * 1.02, low: c.low * 0.98 } : c));
    const r = classifyRegime(wild, "15m", { nowMs: NOW })!;
    expect(["HIGH", "EXTREME"]).toContain(r.volatility);
    expect(r.atrPercentile).toBeGreaterThan(80);
  });

  it("adds context notes without changing the classification", () => {
    const c = make((i) => 100 * 1.003 ** i * wobble(i));
    const base = classifyRegime(c, "15m", { nowMs: NOW })!;
    const ctx = classifyRegime(c, "15m", {
      nowMs: NOW,
      ctx: { fundingClass: "EXTREMELY_POSITIVE", oiRegime: "SHORT_COVERING" },
    })!;
    expect(ctx.trend).toBe(base.trend);
    expect(ctx.trendScore).toBe(base.trendScore);
    expect(ctx.notes.some((n) => n.includes("longs are crowded"))).toBe(true);
    expect(ctx.notes.some((n) => n.includes("short covering"))).toBe(true);
    expect(base.notes.some((n) => n.includes("crowded"))).toBe(false);
  });

  it("describes a range whose volatility is rising, without predicting a breakout", () => {
    const c = make((i) => 100 + 1.5 * Math.sin(i / 2.2), 300, 0.002).map((x, i) =>
      i >= 285 ? { ...x, high: x.high * 1.004, low: x.low * 0.996 } : x,
    );
    const r = classifyRegime(c, "15m", { nowMs: NOW })!;
    expect(r.trend).toBe("RANGE");
    expect(r.volTrend).toBe("EXPANDING");
    expect(r.notes.some((n) => n.includes("swings are widening"))).toBe(true);
  });

  it("flags a trend that has stalled after an impulse: capped strength, penalised confidence, explained", () => {
    // Strong climb for 275 bars, then 25 bars of flat chop. ADX lags and stays elevated; efficiency collapses.
    const c = make((i) => (i < 275 ? 100 * 1.004 ** i : 100 * 1.004 ** 275 * (1 + 0.002 * Math.sin(i * 1.3))), 300);
    const r = classifyRegime(c, "15m", { nowMs: NOW })!;
    expect(r.adx).toBeGreaterThanOrEqual(25);
    expect(r.efficiency).toBeLessThan(0.15);
    expect(r.stalled).toBe(true);
    expect(r.trend).not.toBe("STRONG_UPTREND");
    expect(r.notes.some((n) => n.includes("pausing"))).toBe(true);
    const fresh = classifyRegime(
      make((i) => 100 * 1.003 ** i * wobble(i)),
      "15m",
      { nowMs: NOW },
    )!;
    expect(fresh.stalled).toBe(false);
    expect(r.confidence).toBeLessThan(fresh.confidence);
  });

  it("notes a trend on contracting volume", () => {
    const c = make(
      (i) => 100 * 1.003 ** i * wobble(i),
      300,
      0.002,
      (i) => (i > 298 ? 100 : 1000),
    ); // only the latest bar is quiet vs the 20-bar average
    const r = classifyRegime(c, "15m", { nowMs: NOW })!;
    expect(r.notes.some((n) => n.includes("contracting volume"))).toBe(true);
  });
});

describe("regime helpers", () => {
  it("trendOf gates on ADX and never forces a call on contradictory evidence", () => {
    expect(trendOf(45, 70, 0.7)).toBe("STRONG_UPTREND");
    expect(trendOf(30, 35, 0.5)).toBe("UPTREND");
    expect(trendOf(45, -70, 0.7)).toBe("STRONG_DOWNTREND");
    expect(trendOf(30, -35, 0.5)).toBe("DOWNTREND");
    expect(trendOf(15, 10, 0.2)).toBe("RANGE");
    expect(trendOf(35, 5, 0.5)).toBe("TRANSITION"); // strong ADX but factors disagree
    expect(trendOf(22, 40, 0.5)).toBe("TRANSITION"); // ADX in the grey zone
    expect(trendOf(15, 10, 0.6)).toBe("TRANSITION"); // low ADX but price travelled efficiently
    expect(trendOf(45, 70, 0.05)).toBe("UPTREND"); // high ADX but price has stalled: not "strong"
    expect(trendOf(45, -70, 0.05)).toBe("DOWNTREND");
  });

  it("confidence drops when the trend is stalled", () => {
    const f = [{ key: "a", label: "a", vote: 1, weight: 1, detail: "" }];
    expect(confidenceOf("UPTREND", 45, f, true)).toBeLessThan(confidenceOf("UPTREND", 45, f, false));
  });

  it("caps confidence for TRANSITION", () => {
    const f = [{ key: "a", label: "a", vote: 0.1, weight: 1, detail: "" }];
    expect(confidenceOf("TRANSITION", 22, f)).toBeLessThanOrEqual(40);
  });

  it("efficiency ratio is 1 for a straight line and near 0 for chop", () => {
    expect(efficiencyRatio(Array.from({ length: 40 }, (_, i) => 100 + i)).er).toBeCloseTo(1, 9);
    expect(efficiencyRatio(Array.from({ length: 40 }, (_, i) => 100 + (i % 2))).er).toBeLessThan(0.1);
    expect(efficiencyRatio(Array.from({ length: 40 }, (_, i) => 100 - i)).dir).toBe(-1);
  });

  it("volatility buckets and squeeze override", () => {
    expect(volRegimeOf(10, false)).toBe("LOW");
    expect(volRegimeOf(50, false)).toBe("NORMAL");
    expect(volRegimeOf(85, false)).toBe("HIGH");
    expect(volRegimeOf(99, false)).toBe("EXTREME");
    expect(volRegimeOf(99, true)).toBe("SQUEEZE");
  });

  it("percentile rank", () => {
    expect(percentileRank(5, [1, 2, 3, 4, 5])).toBe(100);
    expect(percentileRank(3, [1, 2, 3, 4, 5])).toBe(60);
    expect(percentileRank(1, [])).toBe(50);
  });

  it("mtfAlignment summarises agreement and conflict", () => {
    expect(mtfAlignment([])).toBeNull();
    expect(mtfAlignment(["UPTREND", "STRONG_UPTREND", "UPTREND"])!.label).toBe("All timeframes trending up");
    expect(mtfAlignment(["UPTREND", "DOWNTREND", "RANGE"])!.label).toContain("conflict");
    expect(mtfAlignment(["UPTREND", "RANGE", "TRANSITION"])!.label).toBe("1 of 3 timeframes trending up");
    expect(mtfAlignment(["RANGE", "RANGE"])!.label).toBe("All timeframes ranging");
    expect(mtfAlignment(["TRANSITION", null])!.label).toBe("No timeframe shows a clear trend");
  });
});
