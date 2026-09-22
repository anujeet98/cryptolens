import { afterEach, describe, expect, it, vi } from "vitest";
import type { Regime } from "@/regime/regime";

vi.mock("@/exchanges/binance", () => ({
  binance: { getCandles: vi.fn(async () => Array(150).fill(0)) },
}));
vi.mock("@/regime/regime", () => ({ classifyRegime: vi.fn() }));

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

function ticker(symbol: string, quoteVolume: string) {
  return { symbol, lastPrice: "100", priceChangePercent: "1", quoteVolume };
}

describe("scanMarket", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("ranks by ATR percentile first, breaking ties by |trendScore| * confidence", async () => {
    const { classifyRegime } = await import("@/regime/regime");
    const { binance } = await import("@/exchanges/binance");
    const CANDLES_A = [{ marker: "A" }] as never;
    const CANDLES_B = [{ marker: "B" }] as never;
    const CANDLES_C = [{ marker: "C" }] as never;
    vi.mocked(binance.getCandles).mockImplementation(async (symbol: string) =>
      symbol === "AUSDT" ? CANDLES_A : symbol === "BUSDT" ? CANDLES_B : CANDLES_C,
    );
    vi.mocked(classifyRegime).mockImplementation((candles) => {
      if (candles === CANDLES_A) return regime({ atrPercentile: 95, trendScore: 10, confidence: 50 }); // highest vol
      if (candles === CANDLES_B) return regime({ atrPercentile: 40, trendScore: 90, confidence: 90 }); // strong trend but low vol
      if (candles === CANDLES_C) return regime({ atrPercentile: 39, trendScore: 10, confidence: 50 }); // similar vol to B, weak trend
      return null;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [ticker("AUSDT", "3000000"), ticker("BUSDT", "2000000"), ticker("CUSDT", "1000000")],
      })),
    );

    const { scanMarket } = await import("./scanMarket");
    const results = await scanMarket({ candidatePool: 10, limit: 10 });

    // A wins on ATR percentile alone (95 vs ~40, >1pt apart). B beats C: same tier of volatility (within 1pt),
    // so the tiebreak (|trendScore| * confidence) decides, and B's is far higher.
    expect(results.map((r) => r.symbol)).toEqual(["AUSDT", "BUSDT", "CUSDT"]);
  });

  it("drops symbols the regime engine can't classify instead of throwing", async () => {
    const { classifyRegime } = await import("@/regime/regime");
    const { binance } = await import("@/exchanges/binance");
    vi.mocked(binance.getCandles).mockImplementation(async (symbol: string) => [{ marker: symbol }] as never);
    vi.mocked(classifyRegime).mockImplementation((candles) =>
      (candles as unknown as { marker: string }[])[0].marker === "AUSDT" ? regime({}) : null,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [ticker("AUSDT", "5000000"), ticker("BUSDT", "4000000")] })),
    );

    const { scanMarket } = await import("./scanMarket");
    const results = await scanMarket({ candidatePool: 10, limit: 10 });

    expect(results.map((r) => r.symbol)).toEqual(["AUSDT"]);
  });

  it("excludes non-USDT and delivery-contract symbols from the candidate pool", async () => {
    const { classifyRegime } = await import("@/regime/regime");
    vi.mocked(classifyRegime).mockReturnValue(regime({}));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [ticker("AUSDT", "5000000"), ticker("BUSDC", "9000000"), ticker("A_USDT_251226", "9000000")],
      })),
    );

    const { scanMarket } = await import("./scanMarket");
    const results = await scanMarket({ candidatePool: 10, limit: 10 });

    expect(results.map((r) => r.symbol)).toEqual(["AUSDT"]);
  });
});
