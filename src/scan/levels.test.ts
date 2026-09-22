import { describe, expect, it } from "vitest";
import { findLevels } from "./levels";
import type { Candle } from "@/types/market";

const NOW = 1_700_000_000_000;

/** Triangle wave between `lo` and `hi` with period `period` bars — touches lo/hi repeatedly at the same price. */
function triangleWave(n: number, lo: number, hi: number, period: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const phase = (i % period) / period;
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2; // 0..1..0
    const close = lo + tri * (hi - lo);
    return {
      time: NOW / 1000 + i * 900,
      open: close,
      high: close + (hi - lo) * 0.01,
      low: close - (hi - lo) * 0.01,
      close,
      volume: 1000,
      quoteVolume: 1000 * close,
      closed: true,
    };
  });
}

describe("findLevels", () => {
  it("clusters repeated swing lows/highs into support/resistance zones with touch counts", () => {
    const candles = triangleWave(90, 100, 120, 10); // 9 full cycles -> multiple touches near 100 and 120
    const levels = findLevels(candles, { pivotWindow: 2 });

    const support = levels.find((l) => l.type === "support" && Math.abs(l.price - 100) < 1);
    const resistance = levels.find((l) => l.type === "resistance" && Math.abs(l.price - 120) < 1);

    expect(support).toBeDefined();
    expect(resistance).toBeDefined();
    expect(support!.touches).toBeGreaterThanOrEqual(3);
    expect(resistance!.touches).toBeGreaterThanOrEqual(3);
  });

  it("returns nothing for too little history", () => {
    expect(findLevels(triangleWave(5, 100, 120, 10))).toEqual([]);
  });

  it("ranks the most-touched levels first", () => {
    const candles = triangleWave(90, 100, 120, 10);
    const levels = findLevels(candles, { pivotWindow: 2 });
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i - 1].touches).toBeGreaterThanOrEqual(levels[i].touches);
    }
  });
});
