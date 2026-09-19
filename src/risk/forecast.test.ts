import { describe, expect, it } from "vitest";
import { RISK_HORIZONS, RISK_TABLE, forecastRanges, regimeHint, windowLabel } from "./forecast";

describe("RISK_TABLE", () => {
  it("is monotonic: higher quantiles are wider, and longer horizons are wider", () => {
    for (const h of RISK_HORIZONS) {
      const t = RISK_TABLE[h];
      expect(t.p50).toBeGreaterThan(1); // a window's range is at least about one ATR
      expect(t.p80).toBeGreaterThan(t.p50);
      expect(t.p90).toBeGreaterThan(t.p80);
    }
    for (let i = 1; i < RISK_HORIZONS.length; i++) {
      const a = RISK_TABLE[RISK_HORIZONS[i - 1]], b = RISK_TABLE[RISK_HORIZONS[i]];
      expect(b.p50).toBeGreaterThan(a.p50);
      expect(b.p90).toBeGreaterThan(a.p90);
    }
  });
  it("grows sub-linearly in horizon (range scales roughly with sqrt(time), not time)", () => {
    expect(RISK_TABLE[24].p50 / RISK_TABLE[4].p50).toBeLessThan(6); // 6x the bars
    expect(RISK_TABLE[24].p50 / RISK_TABLE[4].p50).toBeGreaterThan(1);
  });
});

describe("forecastRanges", () => {
  it("scales the table by the current ATR%", () => {
    const f = forecastRanges(0.5);
    expect(f.map((x) => x.h)).toEqual([4, 12, 24]);
    expect(f[0].p50).toBeCloseTo(0.5 * RISK_TABLE[4].p50, 12);
    expect(f[2].p90).toBeCloseTo(0.5 * RISK_TABLE[24].p90, 12);
  });
  it("doubles when ATR doubles", () => {
    const a = forecastRanges(0.3), b = forecastRanges(0.6);
    for (let i = 0; i < a.length; i++) expect(b[i].p80).toBeCloseTo(2 * a[i].p80, 12);
  });
});

describe("windowLabel", () => {
  it("formats bars as wall-clock time on the selected timeframe", () => {
    expect(windowLabel(4, 900)).toBe("1h"); // 4 x 15m
    expect(windowLabel(12, 900)).toBe("3h");
    expect(windowLabel(24, 900)).toBe("6h");
    expect(windowLabel(4, 3600)).toBe("4h");
    expect(windowLabel(24, 3600)).toBe("1d");
    expect(windowLabel(4, 14400)).toBe("16h");
    expect(windowLabel(12, 14400)).toBe("2d");
    expect(windowLabel(4, 86400)).toBe("4d");
    expect(windowLabel(4, 60)).toBe("4m");
    expect(windowLabel(12, 5400)).toBe("18h"); // fractional hours stay readable
    expect(windowLabel(1, 5400)).toBe("1.5h");
  });
});

describe("regimeHint", () => {
  it("points the right way for low and high volatility and stays quiet otherwise", () => {
    expect(regimeHint("SQUEEZE")).toContain("expand");
    expect(regimeHint("LOW")).toContain("expand");
    expect(regimeHint("HIGH")).toContain("settle back");
    expect(regimeHint("EXTREME")).toContain("settle back");
    expect(regimeHint("NORMAL")).toBeNull();
  });
  it("never claims a breakout or a direction", () => {
    for (const v of ["SQUEEZE", "LOW", "HIGH", "EXTREME"] as const) expect(regimeHint(v)).not.toMatch(/breakout|rally|drop|bullish|bearish/i);
  });
});
