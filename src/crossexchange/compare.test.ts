import { describe, expect, it } from "vitest";
import { compareExchanges, to8h, type ExchangeRow } from "./compare";

const row = (o: Partial<ExchangeRow> & { exchange: ExchangeRow["exchange"] }): ExchangeRow => ({
  symbol: "BTCUSDT", price: 100, mark: 100, index: 100, fundingRate: 0.0001, fundingIntervalHours: 8,
  nextFundingTime: 0, oiUsd: 1000, volume24hUsd: 5000, changePct24h: 1, ...o,
});

describe("to8h", () => {
  it("scales 4h and 1h funding to an 8h equivalent", () => {
    expect(to8h(0.0001, 8)).toBeCloseTo(0.0001, 12);
    expect(to8h(0.0001, 4)).toBeCloseTo(0.0002, 12);
    expect(to8h(0.0001, 1)).toBeCloseTo(0.0008, 12);
    expect(to8h(0.0001, 0)).toBeCloseTo(0.0001, 12); // bad interval falls back to 8h
  });
});

describe("compareExchanges", () => {
  it("returns null with no usable rows", () => {
    expect(compareExchanges([])).toBeNull();
    expect(compareExchanges([row({ exchange: "binance", mark: 0 })])).toBeNull();
  });

  it("computes basis vs reference, shares and APR", () => {
    const c = compareExchanges([
      row({ exchange: "binance", mark: 100, oiUsd: 3000, volume24hUsd: 9000 }),
      row({ exchange: "bybit", mark: 100.1, oiUsd: 1000, volume24hUsd: 1000 }),
    ])!;
    expect(c.ref).toBe("binance");
    const by = c.rows.find((r) => r.exchange === "bybit")!;
    expect(by.markVsRefBps).toBeCloseTo(10, 6);
    expect(c.rows[0].oiSharePct).toBeCloseTo(75, 6);
    expect(c.rows[0].volumeSharePct).toBeCloseTo(90, 6);
    expect(c.rows[0].fundingApr).toBeCloseTo(0.0001 * 3 * 365, 9);
    expect(c.markSpreadBps).toBeCloseTo(10, 6);
  });

  it("compares funding on an 8h-equivalent basis and notes a real spread", () => {
    const c = compareExchanges([
      row({ exchange: "binance", fundingRate: 0.0001, fundingIntervalHours: 8 }),
      row({ exchange: "bybit", fundingRate: 0.0002, fundingIntervalHours: 4 }), // = 0.0004 per 8h
    ])!;
    expect(c.fundingSpread8hBps).toBeCloseTo(3, 6);
    expect(c.notes.some((n) => n.includes("Funding differs") && n.includes("bybit is highest"))).toBe(true);
  });

  it("does not raise a funding note when venues agree once normalised", () => {
    const c = compareExchanges([
      row({ exchange: "binance", fundingRate: 0.0002, fundingIntervalHours: 4 }),
      row({ exchange: "bybit", fundingRate: 0.0004, fundingIntervalHours: 8 }),
    ])!;
    expect(c.fundingSpread8hBps).toBeCloseTo(0, 9);
    expect(c.notes.filter((n) => n.includes("Funding differs"))).toHaveLength(0);
  });

  it("excludes a mismatched-size contract from totals and spreads", () => {
    const c = compareExchanges([
      row({ exchange: "binance", mark: 100, oiUsd: 1000, volume24hUsd: 1000 }),
      row({ exchange: "bybit", mark: 100_000, oiUsd: 9_999_999, volume24hUsd: 9_999_999 }), // a 1000x contract
    ])!;
    const by = c.rows.find((r) => r.exchange === "bybit")!;
    expect(by.suspect).toBe(true);
    expect(by.oiSharePct).toBe(0);
    expect(c.oiTotalUsd).toBe(1000);
    expect(c.markSpreadBps).toBe(0);
    expect(c.notes[0]).toContain("contract size probably differs");
  });

  it("falls back to the first venue when the reference is missing, and flags OI concentration", () => {
    const c = compareExchanges([
      row({ exchange: "bybit", oiUsd: 8000 }),
      row({ exchange: "okx", oiUsd: 1000 }),
    ])!;
    expect(c.ref).toBe("bybit");
    expect(c.notes.some((n) => n.includes("holds 89% of open interest"))).toBe(true);
  });
});
