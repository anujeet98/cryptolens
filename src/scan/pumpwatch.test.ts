import { describe, expect, it } from "vitest";
import {
  classifyFlowRegime,
  commentate,
  readPump,
  type CommentaryState,
  type FlowCandle,
  type PumpInputs,
} from "./pumpwatch";

function candle(close: number, opts: Partial<FlowCandle> = {}): FlowCandle {
  return {
    open: close,
    high: close * 1.001,
    low: close * 0.999,
    close,
    baseVolume: 1000,
    quoteVolume: 1000 * close,
    takerBuyBase: 500,
    ...opts,
  };
}

/** Flat base, a pump from 100 to 130, then `tail` bars ending at `lastClose`. */
function pumpSeries(lastClose: number, buyShare = 0.5): FlowCandle[] {
  const bars: FlowCandle[] = [];
  for (let i = 0; i < 60; i++) bars.push(candle(100));
  for (let i = 1; i <= 30; i++) bars.push(candle(100 + i));
  for (let i = 0; i < 60; i++) {
    const c = 130 + ((lastClose - 130) * (i + 1)) / 60;
    bars.push(candle(c, { takerBuyBase: 1000 * buyShare, open: c - (buyShare > 0.5 ? 0.1 : -0.1) }));
  }
  return bars;
}

function inputs(over: Partial<PumpInputs> = {}): PumpInputs {
  return {
    perp: pumpSeries(128),
    spot: null,
    oiHist5m: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
    fundingPct: 0.01,
    basisPct: 0,
    retailLongShort: [1.5, 1.5],
    topLongShort: [1.3, 1.3],
    bids1pctUsd: 1000,
    asks1pctUsd: 1000,
    shortLiqs5mUsd: 0,
    longLiqs5mUsd: 0,
    ...over,
  };
}

describe("classifyFlowRegime", () => {
  it("maps price/OI direction pairs to the four regimes", () => {
    expect(classifyFlowRegime(1, 2)).toBe("new_longs");
    expect(classifyFlowRegime(1, -2)).toBe("short_covering");
    expect(classifyFlowRegime(-1, 2)).toBe("shorts_piling");
    expect(classifyFlowRegime(-1, -2)).toBe("longs_exiting");
    expect(classifyFlowRegime(0.1, 2)).toBe("mixed");
  });
});

describe("readPump", () => {
  it("finds the pump leg and a shallow pullback when price holds near the high", () => {
    const r = readPump(inputs());
    expect(r.legLow).toBeLessThan(100);
    expect(r.legHigh).toBeGreaterThan(130);
    expect(r.pullbackPct).toBeLessThan(38);
    expect(r.factors.find((f) => f.name.startsWith("Shallow pullback"))?.ok).toBe(true);
  });

  it("scores a strong setup higher than an unwinding one", () => {
    const strong = readPump(
      inputs({
        perp: pumpSeries(129, 0.7),
        oiHist5m: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 110],
        retailLongShort: [1.5, 1.2],
        fundingPct: -0.05,
        bids1pctUsd: 3000,
        shortLiqs5mUsd: 2000,
      }),
    );
    const weak = readPump(
      inputs({
        perp: pumpSeries(108, 0.3),
        oiHist5m: [110, 110, 110, 110, 110, 110, 110, 110, 110, 110, 110, 110, 100],
        fundingPct: 0.08,
        asks1pctUsd: 3000,
      }),
    );
    expect(strong.score).toBeGreaterThanOrEqual(8);
    expect(weak.score).toBeLessThanOrEqual(4);
    expect(weak.regime).toBe("longs_exiting");
    expect(weak.warnings.some((w) => w.includes("Funding hot"))).toBe(true);
    expect(weak.warnings.some((w) => w.includes("distribution"))).toBe(true);
  });

  it("reports the spot factor as missing rather than failing when there is no spot market", () => {
    const r = readPump(inputs({ spot: null }));
    const f = r.factors.find((x) => x.name.startsWith("Spot buyers"));
    expect(f?.ok).toBe(false);
    expect(f?.detail).toBe("no spot market");
  });

  it("rejects too little history", () => {
    expect(() => readPump(inputs({ perp: pumpSeries(128).slice(0, 20) }))).toThrow();
  });
});

describe("commentate", () => {
  it("opens with a summary line and the regime", () => {
    const state: CommentaryState = {};
    const lines = commentate(null, readPump(inputs()), state);
    expect(lines[0]).toContain("Watching");
    expect(lines[1]).toContain("OI/price");
  });

  it("stays quiet when nothing meaningful changed", () => {
    const state: CommentaryState = {};
    const r = readPump(inputs());
    commentate(null, r, state);
    expect(commentate(r, r, state)).toEqual([]);
  });

  it("calls out lost VWAP, seller takeover and a regime shift", () => {
    const state: CommentaryState = {};
    const holding = readPump(
      inputs({
        perp: pumpSeries(129, 0.7),
        oiHist5m: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 110],
      }),
    );
    commentate(null, holding, state);
    const dumping = readPump(
      inputs({
        perp: pumpSeries(108, 0.3),
        oiHist5m: [110, 110, 110, 110, 110, 110, 110, 110, 110, 110, 110, 110, 100],
      }),
    );
    const lines = commentate(holding, dumping, state).join("\n");
    expect(lines).toContain("Lost VWAP");
    expect(lines).toContain("Sellers took over");
    expect(lines).toContain("longs exiting");
    expect(lines).toContain("OI dropped");
  });

  it("does not flip VWAP side for a move inside the hysteresis band", () => {
    const state: CommentaryState = {};
    const a = readPump(inputs());
    commentate(null, a, state);
    const b = { ...a, price: a.vwap * 1.0005 };
    const c = { ...a, price: a.vwap * 0.9995 };
    expect(commentate(b, c, state).some((l) => l.includes("VWAP"))).toBe(false);
  });
});
