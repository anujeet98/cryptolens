import { describe, expect, it } from "vitest";
import { classifyStage } from "./stage";
import type { Regime } from "@/regime/regime";

function regime(over: Partial<Regime>): Regime {
  return {
    trend: "RANGE",
    stalled: false,
    volatility: "NORMAL",
    volTrend: "STEADY",
    trendScore: 0,
    confidence: 50,
    adx: 15,
    plusDI: 20,
    minusDI: 20,
    efficiency: 0.1,
    atrPct: 0.5,
    atrPercentile: 50,
    factors: [],
    notes: [],
    ...over,
  };
}

describe("classifyStage", () => {
  it("is igniting when the range is actively widening and not stalled", () => {
    expect(classifyStage(regime({ volatility: "NORMAL", volTrend: "EXPANDING", stalled: false }))).toBe("igniting");
    expect(classifyStage(regime({ volatility: "HIGH", volTrend: "EXPANDING", stalled: false }))).toBe("igniting");
  });

  it("is coiled when compressed (squeeze or low), regardless of volTrend", () => {
    expect(classifyStage(regime({ volatility: "SQUEEZE", volTrend: "STEADY" }))).toBe("coiled");
    expect(classifyStage(regime({ volatility: "LOW", volTrend: "EXPANDING" }))).toBe("coiled");
  });

  it("is extended when at a volatility extreme but no longer widening", () => {
    expect(classifyStage(regime({ volatility: "EXTREME", volTrend: "STEADY", stalled: false }))).toBe("extended");
    expect(classifyStage(regime({ volatility: "HIGH", volTrend: "STEADY", stalled: false }))).toBe("extended");
  });

  it("is exhausted when stalled, even if still labeled as widening", () => {
    expect(classifyStage(regime({ volatility: "HIGH", volTrend: "EXPANDING", stalled: true }))).toBe("exhausted");
  });

  it("is exhausted when a high-vol state is now contracting", () => {
    expect(classifyStage(regime({ volatility: "EXTREME", volTrend: "CONTRACTING", stalled: false }))).toBe(
      "exhausted",
    );
  });

  it("falls back to extended for steady mid-volatility with nothing building", () => {
    expect(classifyStage(regime({ volatility: "NORMAL", volTrend: "STEADY", stalled: false }))).toBe("extended");
  });

  it("stalled takes priority over coiled", () => {
    expect(classifyStage(regime({ volatility: "SQUEEZE", volTrend: "STEADY", stalled: true }))).toBe("exhausted");
  });
});
