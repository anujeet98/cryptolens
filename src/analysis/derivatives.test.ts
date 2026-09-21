import { describe, expect, it } from "vitest";
import { analyzeFunding, classifyFunding, fundingContext, fundingIntervalHours } from "./funding";
import { analyzeOi, interpretOi } from "./openInterest";
import type { DerivativesSnapshot, FundingPoint, OiPoint } from "@/types/market";

const NOW = 1_800_000_000;
const fh = (rates: number[], stepH = 8): FundingPoint[] =>
  rates.map((r, i) => ({ time: NOW - (rates.length - i) * stepH * 3600, rate: r }));

describe("funding", () => {
  it("infers interval", () => {
    expect(fundingIntervalHours(fh([1, 1, 1, 1], 8))).toBe(8);
    expect(fundingIntervalHours(fh([1, 1, 1, 1], 4))).toBe(4);
    expect(fundingIntervalHours([])).toBe(8);
  });
  it("normalises to 8h and annualises", () => {
    const a = analyzeFunding(fh(new Array(30).fill(0.0001), 4), 0.0001, NOW);
    expect(a.rate8h).toBeCloseTo(0.0002, 10);
    expect(a.annualizedPct).toBeCloseTo(0.0001 * 6 * 365 * 100, 6);
  });
  it("classifies by absolute bp per 8h", () => {
    expect(classifyFunding(0.0001, null)).toBe("NEUTRAL");
    expect(classifyFunding(0.0004, null)).toBe("POSITIVE");
    expect(classifyFunding(0.001, null)).toBe("EXTREMELY_POSITIVE");
    expect(classifyFunding(-0.0004, null)).toBe("NEGATIVE");
    expect(classifyFunding(-0.0012, null)).toBe("EXTREMELY_NEGATIVE");
  });
  it("percentile escalates a historically extreme but absolutely modest reading", () => {
    expect(classifyFunding(0.00025, 99)).toBe("EXTREMELY_POSITIVE");
    expect(classifyFunding(0.00005, 99)).toBe("NEUTRAL"); // near baseline never escalates
  });
  it("percentile over window", () => {
    const hist = fh(Array.from({ length: 90 }, (_, i) => (i + 1) * 0.00001));
    const a = analyzeFunding(hist, 0.00095, NOW); // above every sample
    expect(a.percentile30d).toBe(100);
    expect(a.samples7d).toBeLessThan(a.samples30d);
  });
  it("context combines funding with price direction, never funding alone", () => {
    expect(fundingContext("EXTREMELY_NEGATIVE", 2)).toMatch(/squeeze/);
    expect(fundingContext("EXTREMELY_POSITIVE", -2)).toMatch(/trapped/);
    expect(fundingContext("NEUTRAL", 2)).toBeNull();
    expect(fundingContext("EXTREMELY_POSITIVE", 0)).toMatch(/not a reversal signal/);
  });
});

describe("open interest", () => {
  it("interpretation matrix", () => {
    expect(interpretOi(1, 2)).toBe("NEW_LONGS");
    expect(interpretOi(1, -2)).toBe("SHORT_COVERING");
    expect(interpretOi(-1, 2)).toBe("NEW_SHORTS");
    expect(interpretOi(-1, -2)).toBe("LONG_CLOSING");
    expect(interpretOi(0.05, 5)).toBe("NEUTRAL");
    expect(interpretOi(2, 0.1)).toBe("NEUTRAL");
  });
  const snap = (oi: number, mark: number): DerivativesSnapshot => ({
    exchange: "binance",
    symbol: "X",
    timestamp: NOW * 1000,
    markPrice: mark,
    indexPrice: mark,
    fundingRate: 0,
    nextFundingTime: 0,
    openInterest: oi,
    openInterestUsd: oi * mark,
  });
  const hist = (n: number, f: (i: number) => { oi: number; px: number }): OiPoint[] =>
    Array.from({ length: n }, (_, i) => {
      const { oi, px } = f(i);
      return { time: NOW - (n - i) * 300, oi, oiUsd: oi * px };
    });

  it("computes changes in contracts with implied historical price", () => {
    const h = hist(300, () => ({ oi: 1000, px: 100 }));
    const a = analyzeOi(h, snap(1100, 102))!; // +10% OI, +2% price vs every past point
    const w1h = a.windows.find((w) => w.label === "1h")!;
    expect(w1h.oiChangePct).toBeCloseTo(10, 8);
    expect(w1h.priceChangePct).toBeCloseTo(2, 8);
    expect(w1h.regime).toBe("NEW_LONGS");
  });
  it("uses the point at or before the window start (no look-ahead)", () => {
    const h = hist(300, (i) => ({ oi: 1000 + i, px: 100 }));
    const a = analyzeOi(h, snap(1300, 100))!;
    const target = NOW - 3600;
    const p = h.filter((x) => x.time <= target).at(-1)!;
    expect(a.windows.find((w) => w.label === "1h")!.oiChangePct).toBeCloseTo(((1300 - p.oi) / p.oi) * 100, 8);
  });
  it("window unavailable → null, z-score for an outlier is large", () => {
    const h = hist(20, (i) => ({ oi: 1000 + (i % 2), px: 100 }));
    const a = analyzeOi(h, snap(1500, 100))!;
    expect(a.windows.find((w) => w.label === "24h")!.oiChangePct).toBeNull();
    expect(a.zScore!).toBeGreaterThan(5);
  });
  it("too little history → null", () =>
    expect(
      analyzeOi(
        hist(5, () => ({ oi: 1, px: 1 })),
        snap(1, 1),
      ),
    ).toBeNull());
});
