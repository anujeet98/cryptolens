import { describe, expect, it } from "vitest";
import { computeTechnicals } from "./technicals";
import type { Candle } from "@/types/market";

const series = (f: (i: number) => number, n = 260): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return {
      time: i * 900,
      open: c,
      high: c * 1.002,
      low: c * 0.998,
      close: c,
      volume: 100,
      quoteVolume: 100 * c,
      closed: true,
    };
  });

describe("computeTechnicals", () => {
  it("needs enough history", () => expect(computeTechnicals(series((i) => i + 1, 10))).toBeNull());
  it("steady uptrend: bullish alignment, price above EMAs, overbought", () => {
    const t = computeTechnicals(series((i) => 100 * 1.004 ** i))!;
    expect(t.alignment).toBe("BULLISH");
    expect(t.mas.filter((m) => m.kind === "EMA").every((m) => m.priceAbove)).toBe(true);
    expect(t.rsiZone).toBe("OVERBOUGHT");
    expect(t.rsiNote).toMatch(/≠/);
    expect(t.macd?.state).toBe("BULLISH");
  });
  it("steady downtrend: bearish alignment", () => {
    const t = computeTechnicals(series((i) => 100 * 0.996 ** i))!;
    expect(t.alignment).toBe("BEARISH");
    expect(t.rsiZone).toBe("OVERSOLD");
  });
  it("tolerates <200 bars (EMA200 null)", () => {
    const t = computeTechnicals(series((i) => 100 + i, 120))!;
    expect(t.mas.find((m) => m.kind === "EMA" && m.period === 200)?.value).toBeNull();
  });
});
