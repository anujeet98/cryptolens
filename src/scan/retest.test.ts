import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@/types/market";

vi.mock("@/analysis/momentum", () => ({ computeMomentum: vi.fn(() => null) }));
vi.mock("@/analysis/volume", () => ({ analyzeVolume: vi.fn(() => null) }));
vi.mock("@/analysis/technicals", () => ({ computeTechnicals: vi.fn(() => null) }));
vi.mock("@/regime/regime", () => ({ classifyRegime: vi.fn(() => null) }));
vi.mock("@/scan/stage", () => ({ classifyStage: vi.fn(() => "extended") }));

const NOW = 1_700_000_000_000;

/** 8 clean bounces off `support`, holding well below `resistance`, then one final touch at the end
 *  that either rejects (closes back above support) or breaks (closes through it). */
function buildSeries(finalCloseAboveSupport: boolean): Candle[] {
  const support = 100;
  const resistance = 120;
  const bars: Candle[] = [];
  for (let i = 0; i < 90; i++) {
    const t = (i % 10) / 10;
    const tri = t < 0.5 ? t * 2 : 2 - t * 2;
    const close = support + tri * (resistance - support);
    bars.push(mk(bars.length, close, close - 0.2, close + 0.2));
  }
  // Final bar: wick pierces support, close resolves per `finalCloseAboveSupport`.
  bars.push(mk(bars.length, finalCloseAboveSupport ? support + 1 : support - 2, support - 1, support + 0.2));
  return bars;
}

function mk(i: number, close: number, low: number, high: number): Candle {
  return { time: NOW / 1000 + i * 900, open: close, high, low, close, volume: 1000, quoteVolume: 1000 * close, closed: true };
}

describe("detectRetest", () => {
  afterEach(async () => {
    const { computeMomentum } = await import("@/analysis/momentum");
    const { analyzeVolume } = await import("@/analysis/volume");
    vi.mocked(computeMomentum).mockReturnValue(null);
    vi.mocked(analyzeVolume).mockReturnValue(null);
  });

  it("requires a rejection candle: no result when price closes through the level instead of bouncing", async () => {
    const { detectRetest } = await import("./retest");
    const result = detectRetest(buildSeries(false), "15m", { pivotWindow: 2 });
    expect(result).toBeNull();
  });

  it("finds a bounce_up retest off an established support level when the close rejects back above it", async () => {
    const { detectRetest } = await import("./retest");
    const result = detectRetest(buildSeries(true), "15m", { pivotWindow: 2 });

    expect(result).not.toBeNull();
    expect(result!.direction).toBe("bounce_up");
    expect(result!.level.type).toBe("support");
    expect(result!.level.touches).toBeGreaterThanOrEqual(2);
    expect(result!.barsAgo).toBe(0);
  });

  it("is confirmed when the rejection candle plus at least 2 of the 4 optional signals agree", async () => {
    const { computeMomentum } = await import("@/analysis/momentum");
    const { analyzeVolume } = await import("@/analysis/volume");
    vi.mocked(computeMomentum).mockReturnValue({
      score: 40,
      previousScore: 10,
      accelerationPts: 30,
      accelerationPct: 300,
      direction: "BULLISH",
      strength: "STRONG",
      trend: "ACCELERATING",
      condition: "STRONG / ACCELERATING",
      components: [],
    });
    vi.mocked(analyzeVolume).mockReturnValue({
      currentBase: 1,
      currentQuote: 1,
      avgQuote: 1,
      relativeVolume: 1.5,
      projectedRelative: null,
      lastClosedRelative: 1.5,
      candleProgress: 1,
      effectiveRelative: 1.5,
      state: "EXPANSION",
      priceVolume: "HEALTHY_RALLY",
      priceChangePct: 1,
      volumeChangePct: 20,
    });

    const { detectRetest } = await import("./retest");
    const result = detectRetest(buildSeries(true), "15m", { pivotWindow: 2 });

    expect(result!.confirmedSignalCount).toBeGreaterThanOrEqual(2);
    expect(result!.confirmed).toBe(true);
  });

  it("is not confirmed when only the mandatory rejection candle is present and no optional signal agrees", async () => {
    const { detectRetest } = await import("./retest");
    const result = detectRetest(buildSeries(true), "15m", { pivotWindow: 2 });

    expect(result!.confirmedSignalCount).toBe(0);
    expect(result!.confirmed).toBe(false);
  });

  it("returns null when there's no level with enough history", () => {
    // Reuse buildSeries but require an unrealistically high touch count.
    return import("./retest").then(({ detectRetest }) => {
      const result = detectRetest(buildSeries(true), "15m", { pivotWindow: 2, minTouches: 99 });
      expect(result).toBeNull();
    });
  });
});
