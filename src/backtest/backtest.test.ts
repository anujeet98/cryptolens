import { describe, expect, it } from "vitest";
import { MIN_EFF, forwardRange, forwardReturn, runStudy, type SignalFn } from "./study";
import { simulate } from "./sim";
import type { Candle } from "@/types/market";

const STEP = 3600;
/** Build candles from per-bar returns: open = previous close, close = open * (1 + r). */
const fromReturns = (rs: number[], start = 100): Candle[] => {
  let prev = start;
  return rs.map((r, i) => {
    const o = prev, c = o * (1 + r);
    prev = c;
    return { time: i * STEP, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c, volume: 1, quoteVolume: c, closed: true };
  });
};
const cd = (time: number, open: number, close: number): Candle => ({ time, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1, quoteVolume: close, closed: true });

function prng(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

describe("forwardReturn", () => {
  it("enters at the next open and exits at the horizon close", () => {
    const c = [cd(0, 10, 10), cd(1, 11, 12), cd(2, 12, 15), cd(3, 15, 18)];
    expect(forwardReturn(c, 0, 1)).toBeCloseTo(12 / 11 - 1, 12); // open[1] -> close[1]
    expect(forwardReturn(c, 0, 2)).toBeCloseTo(15 / 11 - 1, 12); // open[1] -> close[2]
    expect(forwardReturn(c, 2, 1)).toBeCloseTo(18 / 15 - 1, 12);
    expect(forwardReturn(c, 2, 2)).toBeNull(); // history ends first
  });
});

describe("forwardRange", () => {
  it("is the high-low span of the next h bars over the entry open, direction-free", () => {
    const c: Candle[] = [
      { ...cd(0, 10, 10) },
      { ...cd(1, 10, 12), high: 13, low: 9 },
      { ...cd(2, 12, 11), high: 14, low: 8 },
      { ...cd(3, 11, 11), high: 11, low: 11 },
    ];
    expect(forwardRange(c, 0, 1)).toBeCloseTo((13 - 9) / 10, 12);
    expect(forwardRange(c, 0, 2)).toBeCloseTo((14 - 8) / 10, 12);
    expect(forwardRange(c, 2, 1)).toBeCloseTo(0, 12); // a flat next bar
    expect(forwardRange(c, 2, 2)).toBeNull();
  });
});

describe("runStudy", () => {
  it("measure=range tells a calm regime from a wild one, where signed returns cannot", () => {
    // 200 calm bars (0.1% moves), 200 wild bars (3% moves), both alternating sign so the mean return is ~0.
    const rs = Array.from({ length: 400 }, (_, i) => (i < 200 ? 0.001 : 0.03) * (i % 2 ? -1 : 1));
    const candles = fromReturns(rs);
    const regime: SignalFn = (w) => (w.at(-1)!.time / STEP < 200 ? "calm" : "wild");
    const range = runStudy(candles, regime, { horizons: [4], window: 20, measure: "range" });
    expect(range.byLabel.wild[4].mean).toBeGreaterThan(10 * range.byLabel.calm[4].mean);
    expect(range.baseline[4].mean).toBeGreaterThan(range.byLabel.calm[4].mean); // baseline uses the same measure
    expect(range.byLabel.wild[4].excess).toBeGreaterThan(0);
    expect(range.byLabel.calm[4].excess).toBeLessThan(0);
  });

  it("never shows the signal a bar beyond the one it labels, and respects the window", () => {
    const candles = fromReturns(Array.from({ length: 60 }, () => 0.001));
    const seen: { last: number; len: number }[] = [];
    const spy: SignalFn = (w) => { seen.push({ last: w.at(-1)!.time, len: w.length }); return "x"; };
    runStudy(candles, spy, { horizons: [1], window: 20 });
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen.map((s) => s.len))).toBeLessThanOrEqual(20);
    expect(Math.max(...seen.map((s) => s.last))).toBe(candles[candles.length - 2].time); // last bar has no next open to trade on
    expect(seen.map((s) => s.last)).toEqual([...seen.map((s) => s.last)].sort((a, b) => a - b)); // strictly walking forward
    expect(new Set(seen.map((s) => s.last)).size).toBe(seen.length);
  });

  it("recovers a known edge exactly: phase of a repeating pattern predicts the next bar", () => {
    const pattern = [0.02, -0.01, -0.01, -0.01];
    const candles = fromReturns(Array.from({ length: 400 }, (_, i) => pattern[i % 4]));
    const phase: SignalFn = (w) => String((w.at(-1)!.time / STEP) % 4);
    const r = runStudy(candles, phase, { horizons: [1], window: 20 });
    // Label 3 is followed by bar phase 0 (+2%); label 0 by phase 1 (-1%).
    expect(r.byLabel["3"][1].mean).toBeCloseTo(0.02, 10);
    expect(r.byLabel["0"][1].mean).toBeCloseTo(-0.01, 10);
    expect(r.byLabel["3"][1].hitRate).toBe(1);
    expect(r.byLabel["0"][1].hitRate).toBe(0);
    expect(r.baseline[1].mean).toBeCloseTo(-0.0025, 4);
    expect(r.byLabel["3"][1].excess).toBeCloseTo(0.0225, 4);
  });

  it("finds nothing in noise: a random label on a random walk is not significant", () => {
    const rnd = prng(7);
    const candles = fromReturns(Array.from({ length: 3000 }, () => (rnd() - 0.5) * 0.02));
    const rl = prng(99);
    const random: SignalFn = () => (rl() < 0.5 ? "A" : "B");
    const r = runStudy(candles, random, { horizons: [1, 12], window: 50 });
    for (const label of ["A", "B"]) for (const h of [1, 12]) {
      const s = r.byLabel[label][h];
      expect(s.reliable).toBe(true);
      expect(Math.abs(s.t!)).toBeLessThan(3.5);
    }
  });

  it("deflates the sample size for overlapping horizons and withholds t when data is thin", () => {
    const candles = fromReturns(Array.from({ length: 200 }, () => 0.001));
    const r = runStudy(candles, () => "all", { horizons: [1, 10], window: 20 });
    const a = r.byLabel.all[1], b = r.byLabel.all[10];
    expect(a.nEff).toBe(a.n / 1);
    expect(b.nEff).toBe(b.n / 10);
    expect(b.nEff).toBeLessThan(a.nEff);
    const thin = runStudy(fromReturns([0.01, 0.01, 0.01, 0.01, 0.01]), () => "t", { horizons: [3], window: 1, warmup: 1 });
    expect(thin.byLabel.t[3].t).toBeNull(); // nEff < 2
    expect(thin.byLabel.t[3].reliable).toBe(false);
    expect(MIN_EFF).toBeGreaterThan(2);
  });

  it("skips bars with no opinion but still counts them in the baseline", () => {
    const candles = fromReturns(Array.from({ length: 100 }, (_, i) => (i % 2 ? 0.01 : -0.01)));
    const r = runStudy(candles, (w) => ((w.at(-1)!.time / STEP) % 2 === 0 ? "even" : null), { horizons: [1], window: 10 });
    expect(Object.keys(r.byLabel)).toEqual(["even"]);
    expect(r.labelled).toBeLessThan(r.baseline[1].n + 1);
    expect(r.baseline[1].n).toBeGreaterThan(r.byLabel.even[1].n);
  });
});

describe("simulate", () => {
  const opts = (feeBps = 0, slipBps = 0) => ({ feeBps, slipBps, barsPerYear: 8760 });

  it("marks a held long close-to-close and matches buy-and-hold with no costs", () => {
    const c = [cd(0, 100, 100), cd(1, 100, 110), cd(2, 110, 121)];
    const r = simulate(c, [1, 1, 0], 0, opts());
    expect(r.equity[1]).toBeCloseTo(1.1, 12);
    expect(r.totalReturn).toBeCloseTo(0.21, 12);
    expect(r.buyHoldReturn).toBeCloseTo(0.21, 12);
    expect(r.trades).toBe(1);
    expect(r.exposure).toBe(1);
  });

  it("charges fee and slippage on every unit traded, entry and exit", () => {
    const c = [cd(0, 100, 100), cd(1, 100, 110), cd(2, 110, 121), cd(3, 121, 121)];
    const r = simulate(c, [1, 1, 0, 0], 0, opts(10, 0)); // 10 bps per side; enter bar 1, exit bar 3
    // bar1: +10% - 0.1%; bar2: +10%; bar3: exit at open 121 (prevClose 121 -> 0%) - 0.1%
    expect(r.equity[3]).toBeCloseTo((1 + 0.099) * 1.1 * (1 - 0.001), 12);
    expect(r.costPaid).toBeCloseTo(0.002, 12);
    const withSlip = simulate(c, [1, 1, 0, 0], 0, opts(10, 5));
    expect(withSlip.totalReturn).toBeLessThan(r.totalReturn);
  });

  it("books a gap at the new open when exiting, and a flip costs two units and counts as one entry", () => {
    const c = [cd(0, 100, 100), cd(1, 105, 105), cd(2, 105, 105)]; // gap up from 100 to 105 at bar 1's open
    const long = simulate(c, [1, 0, 0], 0, opts()); // enter at bar 1's open (105): the gap is NOT earned
    expect(long.totalReturn).toBeCloseTo(0, 12);
    const flip = simulate([cd(0, 100, 100), cd(1, 100, 110), cd(2, 110, 110), cd(3, 110, 99)], [1, -1, -1, 0], 0, opts(10, 0));
    // bar1: enter long +10% -0.1%; bar2: exit long at open 110 (prevClose 110 -> 0), enter short, flat bar (0%), -0.2%; bar3: hold short, +10%.
    // desired[3] is decided at the last close and can never be executed, so there is no exit cost.
    expect(flip.trades).toBe(2);
    expect(flip.costPaid).toBeCloseTo(0.001 + 0.002, 12); // enter (1 unit) + flip (2 units)
    expect(flip.totalReturn).toBeCloseTo((1 + 0.1 - 0.001) * (1 - 0.002) * (1 + 0.1) - 1, 12);
    expect(flip.equity[1]).toBeCloseTo(1 + 0.1 - 0.001, 12);
  });

  it("reports drawdown, exposure and a null Sharpe for a flat strategy", () => {
    const c = [cd(0, 100, 100), cd(1, 100, 120), cd(2, 120, 60), cd(3, 60, 90)];
    const r = simulate(c, [1, 1, 1, 1], 0, opts());
    expect(r.maxDrawdown).toBeCloseTo(-0.5, 12); // 1.2 -> 0.6
    const flat = simulate(c, [0, 0, 0, 0], 0, opts());
    expect(flat.totalReturn).toBe(0);
    expect(flat.exposure).toBe(0);
    expect(flat.sharpe).toBeNull();
    expect(flat.trades).toBe(0);
  });
});
