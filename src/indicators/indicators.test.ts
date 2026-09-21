import { describe, expect, it } from "vitest";
import { adx, bollinger, crossIndex, divergences, ema, failureSwing, macd, pivots, rsi, sma, vwap } from "./index";
import type { Candle } from "@/types/market";

const cd = (o: number, h: number, l: number, c: number, v = 1, time = 0): Candle => ({
  time,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
  quoteVolume: v * c,
  closed: true,
});

describe("sma/ema", () => {
  it("sma", () => expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]));
  it("ema seeded with sma", () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e.slice(0, 2)).toEqual([null, null]);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3, 10); // 4*.5 + 2*.5
    expect(e[4]).toBeCloseTo(4, 10);
  });
  it("short input", () => expect(ema([1, 2], 5)).toEqual([null, null]));
});

describe("rsi", () => {
  it("monotonic rise = 100, fall = 0", () => {
    const up = Array.from({ length: 30 }, (_, i) => i);
    expect(rsi(up, 14)[29]).toBe(100);
    expect(rsi([...up].reverse(), 14)[29]).toBeCloseTo(0, 10);
  });
  it("matches Wilder's classic worked example (~70.5)", () => {
    const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(c, 14)[14]).toBeCloseTo(70.46, 1);
  });
  it("null before period", () => expect(rsi([1, 2, 3], 14)).toEqual([null, null, null]));
});

describe("macd", () => {
  it("hist = macd - signal and aligned", () => {
    const v = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 5 + i * 0.1);
    const m = macd(v);
    expect(m.macd.length).toBe(80);
    expect(m.macd[24]).toBeNull();
    expect(m.macd[25]).not.toBeNull();
    expect(m.signal[32]).toBeNull();
    expect(m.signal[33]).not.toBeNull(); // 25 + 9 - 1
    expect(m.hist[60]).toBeCloseTo(m.macd[60]! - m.signal[60]!, 12);
  });
});

describe("bollinger", () => {
  it("constant price: zero bandwidth, %B .5", () => {
    const b = bollinger(new Array(25).fill(10), 20);
    expect(b.bandwidth[24]).toBe(0);
    expect(b.percentB[24]).toBe(0.5);
  });
  it("population stddev", () => {
    const b = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2); // mean 5, sd 2
    expect(b.upper[7]).toBeCloseTo(9, 10);
    expect(b.lower[7]).toBeCloseTo(1, 10);
  });
});

describe("vwap", () => {
  it("resets each UTC day", () => {
    const d = 86400;
    const v = vwap([cd(1, 3, 1, 2, 1, 0), cd(1, 6, 6, 6, 1, 3600), cd(9, 9, 9, 9, 5, d)], "day");
    expect(v[0]).toBeCloseTo(2, 10);
    expect(v[1]).toBeCloseTo((2 + 6) / 2, 10);
    expect(v[2]).toBeCloseTo(9, 10);
  });
  it("weekly anchor starts Monday", () => {
    const mon = 4 * 86400; // 1970-01-05 is a Monday
    const v = vwap([cd(1, 1, 1, 1, 1, mon - 3600), cd(5, 5, 5, 5, 1, mon)], "week");
    expect(v[1]).toBeCloseTo(5, 10);
  });
});

describe("pivots", () => {
  it("finds confirmed swing high and never in last `right` bars", () => {
    const v = [1, 2, 3, 5, 3, 2, 1, 2, 9];
    expect(pivots(v, 2, 2, "high")).toEqual([{ index: 3, price: 5 }]);
    expect(pivots(v, 2, 2, "low")).toEqual([{ index: 6, price: 1 }]);
  });
});

describe("crossIndex", () => {
  it("detects up cross", () => expect(crossIndex([1, 2, 3, 5], [3, 3, 3, 3], 5)).toEqual({ index: 3, dir: "up" }));
  it("none", () => expect(crossIndex([1, 1, 1], [2, 2, 2], 5)).toBeNull());
});

describe("divergences", () => {
  it("bearish: higher price high, lower RSI high", () => {
    const highs = [1, 2, 5, 2, 1, 2, 6, 2, 1, 1, 1];
    const c = highs.map((h) => cd(h, h, h - 0.5, h));
    const osc = [50, 50, 80, 50, 50, 50, 70, 50, 50, 50, 50];
    const d = divergences(c, osc, 2, 2);
    expect(d.map((x) => x.kind)).toContain("bearish");
  });
});

describe("failureSwing", () => {
  it("bearish failure swing", () => {
    //            peak>70  valley  lower peak  break valley
    const r = [50, 60, 75, 60, 55, 60, 68, 60, 52, 48, 45];
    expect(failureSwing(r)).toBe("bearish");
  });
  it("none on flat", () => expect(failureSwing(new Array(20).fill(50))).toBeNull());
});

describe("adx", () => {
  const series = (f: (i: number) => number, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const c = f(i);
      return cd(c, c * 1.001, c * 0.999, c, 1, i);
    });

  it("is null until 2n-1 and stays within 0..100", () => {
    const r = adx(
      series((i) => 100 + i, 60),
      14,
    );
    expect(r.adx.findIndex((v) => v !== null)).toBe(27); // 2n - 1
    expect(r.plusDI.findIndex((v) => v !== null)).toBe(14);
    for (const v of r.adx)
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
  });
  it("reads a steady uptrend as strong with +DI above -DI", () => {
    const r = adx(
      series((i) => 100 * 1.004 ** i, 120),
      14,
    );
    expect(r.adx.at(-1)!).toBeGreaterThan(40);
    expect(r.plusDI.at(-1)!).toBeGreaterThan(r.minusDI.at(-1)!);
  });
  it("mirrors for a downtrend", () => {
    const r = adx(
      series((i) => 100 * 0.996 ** i, 120),
      14,
    );
    expect(r.adx.at(-1)!).toBeGreaterThan(40);
    expect(r.minusDI.at(-1)!).toBeGreaterThan(r.plusDI.at(-1)!);
  });
  it("reads a sideways oscillation as weak", () => {
    const r = adx(
      series((i) => 100 + 2 * Math.sin(i / 2), 160),
      14,
    );
    expect(r.adx.at(-1)!).toBeLessThan(25);
  });
  it("returns all-null when there is too little data", () => {
    const r = adx(
      series((i) => 100 + i, 20),
      14,
    );
    expect(r.adx.every((v) => v === null)).toBe(true);
  });
});
