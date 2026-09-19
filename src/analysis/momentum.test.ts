import { describe, expect, it } from "vitest";
import { computeMomentum } from "./momentum";
import { analyzeVolume, volumeWindows } from "./volume";
import type { Candle } from "@/types/market";

// deterministic pseudo-noise so tests are stable
const noise = (i: number) => Math.sin(i * 12.9898) * 0.5;
const mk = (closes: number[], vol: (i: number) => number = () => 100): Candle[] =>
  closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    const hi = Math.max(o, c) * 1.001, lo = Math.min(o, c) * 0.999;
    return { time: i * 900, open: o, high: hi, low: lo, close: c, volume: vol(i), quoteVolume: vol(i) * c, closed: true };
  });

describe("momentum", () => {
  it("needs history", () => expect(computeMomentum(mk([1, 2, 3]))).toBeNull());
  it("uptrend is positive, downtrend negative, symmetric-ish", () => {
    const up = computeMomentum(mk(Array.from({ length: 120 }, (_, i) => 100 * 1.003 ** i + noise(i))))!;
    const dn = computeMomentum(mk(Array.from({ length: 120 }, (_, i) => 100 * 0.997 ** i + noise(i))))!;
    expect(up.score).toBeGreaterThan(30);
    expect(dn.score).toBeLessThan(-30);
    expect(up.direction).toBe("BULLISH");
    expect(dn.direction).toBe("BEARISH");
  });
  it("sideways is weak", () => {
    const m = computeMomentum(mk(Array.from({ length: 120 }, (_, i) => 100 + noise(i))))!;
    expect(Math.abs(m.score)).toBeLessThan(25);
  });
  it("rally that flattens reads as decelerating vs one still accelerating", () => {
    const flatten = Array.from({ length: 120 }, (_, i) => (i < 116 ? 100 * 1.004 ** i : 100 * 1.004 ** 116 * (1 + 0.0004 * (i - 116))));
    const accel = Array.from({ length: 120 }, (_, i) => 100 * 1.004 ** i * (i > 100 ? 1.006 ** (i - 100) : 1));
    expect(computeMomentum(mk(flatten))!.trend).toBe("DECELERATING");
    expect(computeMomentum(mk(accel))!.accelerationPts).toBeGreaterThan(computeMomentum(mk(flatten))!.accelerationPts);
  });
  it("volume confirms: same price path, higher volume => higher score", () => {
    const px = Array.from({ length: 120 }, (_, i) => 100 * 1.003 ** i + noise(i));
    const lo = computeMomentum(mk(px))!.score;
    const hi = computeMomentum(mk(px, (i) => (i > 110 ? 400 : 100)))!.score;
    expect(hi).toBeGreaterThan(lo);
  });
  it("thin volume never flips the sign of the volume component", () => {
    const px = Array.from({ length: 120 }, (_, i) => 100 * 0.997 ** i + noise(i));
    const m = computeMomentum(mk(px, (i) => (i > 100 ? 20 : 100)))!;
    expect(m.components.find((k) => k.key === "volume")!.value).toBeCloseTo(0, 10);
  });
  it("weights sum to 1 and components are bounded", () => {
    const m = computeMomentum(mk(Array.from({ length: 120 }, (_, i) => 100 * 1.01 ** i)))!;
    expect(m.components.reduce((s, k) => s + k.weight, 0)).toBeCloseTo(1, 10);
    expect(m.components.every((k) => Math.abs(k.value) <= 1)).toBe(true);
    expect(Math.abs(m.score)).toBeLessThanOrEqual(100);
  });
});

describe("volume", () => {
  const px = Array.from({ length: 60 }, (_, i) => 100 + i * 0.05);
  it("relative volume vs 20-bar mean of previous closed candles", () => {
    const c = mk(px, (i) => (i === 59 ? 250 : 100));
    const v = analyzeVolume(c, "15m")!;
    expect(v.relativeVolume).toBeCloseTo(2.5 * (px[59] / (px.slice(39, 59).reduce((a, b) => a + b, 0) / 20)), 5);
    expect(v.state).toBe("EXPANSION");
  });
  it("partial candle is time-projected only after 30% elapsed", () => {
    const c = mk(px, (i) => (i === 59 ? 50 : 100));
    c[59].closed = false;
    const early = analyzeVolume(c, "15m", (c[59].time + 900 * 0.1) * 1000)!;
    const mid = analyzeVolume(c, "15m", (c[59].time + 900 * 0.5) * 1000)!;
    expect(early.projectedRelative).toBeNull();
    expect(mid.projectedRelative).toBeCloseTo(mid.relativeVolume * 2, 8);
  });
  it("price up + volume down = weakening", () => {
    const c = mk(px.map((p, i) => p + (i > 48 ? (i - 48) * 0.3 : 0)), (i) => (i > 54 ? 40 : 100));
    expect(analyzeVolume(c, "15m")!.priceVolume).toBe("WEAKENING_RALLY");
  });
  it("price down + volume up = strong selling", () => {
    const c = mk(px.map((p, i) => p - (i > 48 ? (i - 48) * 0.3 : 0)), (i) => (i > 54 ? 300 : 100));
    expect(analyzeVolume(c, "15m")!.priceVolume).toBe("STRONG_SELLING");
  });
  it("windows compare against the preceding window", () => {
    const m1 = mk(Array.from({ length: 500 }, () => 10), (i) => (i >= 495 ? 2 : 1));
    const w = volumeWindows(m1);
    expect(w[0].label).toBe("5m");
    expect(w[0].ratio).toBeCloseTo(2, 8);
    expect(w[3].prevQuote).not.toBeNull();
  });
});
