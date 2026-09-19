import { describe, expect, it } from "vitest";
import { buildSnapshot, contextKey, type SnapshotInput } from "./snapshot";
import { emptyState, evaluateSignals } from "./engine";
import type { LiqSnapshot } from "@/liquidations/liqs";
import type { Regime } from "@/regime/regime";
import type { Candle } from "@/types/market";

const regime = (volatility: Regime["volatility"]): Regime => ({
  trend: "RANGE", stalled: false, volatility, volTrend: "STEADY", trendScore: 0, confidence: 50, adx: 15, plusDI: 10, minusDI: 10,
  efficiency: 0.2, atrPct: 0.2, atrPercentile: 50, factors: [], notes: [],
});
const candles: Candle[] = Array.from({ length: 6 }, (_, i) => ({ time: i, open: 100, high: 101, low: 99, close: 100, volume: 1, quoteVolume: 100, closed: true }));
const liq = (symbol: string | null, active: boolean): LiqSnapshot => ({
  symbol, windows: [], recent: [], burst: { active, lastMinUsd: 1, avgMinUsd: 1, dominant: active ? "long" : null },
  market: { longUsd: 0, shortUsd: 0, count: 0, top: [] }, collectedSec: 0,
});
const base = (o: Partial<SnapshotInput> = {}): SnapshotInput => ({
  symbol: "CAPUSDT", market: "perp", tf: "15m", ts: 1000, perpSymbol: "CAPUSDT", liveKey: contextKey("CAPUSDT", "perp", "15m"),
  candles, regime: regime("EXTREME"), liq: liq("CAPUSDT", false), fundingClass: "NEUTRAL", ...o,
});

describe("buildSnapshot", () => {
  it("builds a snapshot when every source belongs to the current context", () => {
    const s = buildSnapshot(base())!;
    expect(s.symbol).toBe("CAPUSDT");
    expect(s.volatility).toBe("EXTREME");
    expect(s.trailingRangePct).not.toBeNull();
    expect(s.liqBurst).not.toBeNull();
  });

  it("refuses candles that were loaded for another coin or timeframe (the stale-data window after a switch)", () => {
    expect(buildSnapshot(base({ liveKey: contextKey("BTCUSDT", "perp", "15m") }))).toBeNull(); // previous coin still held
    expect(buildSnapshot(base({ liveKey: contextKey("CAPUSDT", "perp", "1h") }))).toBeNull(); // previous timeframe
    expect(buildSnapshot(base({ liveKey: contextKey("CAPUSDT", "spot", "15m") }))).toBeNull(); // previous market
    expect(buildSnapshot(base({ liveKey: "" }))).toBeNull(); // still loading
  });

  it("gives no snapshot without a regime", () => {
    expect(buildSnapshot(base({ regime: null }))).toBeNull();
  });

  it("drops liquidation data computed for a different symbol, but keeps the rest", () => {
    const s = buildSnapshot(base({ liq: liq("BTCUSDT", true) }))!;
    expect(s.liqBurst).toBeNull(); // a BTC burst must not be attributed to CAP
    expect(s.volatility).toBe("EXTREME");
    expect(buildSnapshot(base({ perpSymbol: null, liq: liq(null, false) }))!.liqBurst).toBeNull(); // no perp for this coin
  });

  it("REGRESSION: switching to a coin that is already EXTREME must not raise a false 'turned EXTREME' alert", () => {
    const ON = { "vol-extreme": true, "range-spike": true, "liq-burst": true, "funding-extreme": true } as const;
    // User was on a calm BTC. The page switches to CAP; for one render the hook still holds BTC's candles under CAP's name.
    let st = evaluateSignals(ON, buildSnapshot(base({ symbol: "BTCUSDT", perpSymbol: "BTCUSDT", liveKey: contextKey("BTCUSDT", "perp", "15m"), regime: regime("LOW"), liq: liq("BTCUSDT", false), ts: 1000 }))!, emptyState()).state;
    // The bug: that stale render produced a CAP snapshot with BTC's calm regime, priming CAP as "not extreme".
    const stale = buildSnapshot(base({ liveKey: contextKey("BTCUSDT", "perp", "15m"), regime: regime("LOW"), ts: 2000 }));
    expect(stale).toBeNull(); // now refused, so the engine is never primed on the wrong coin's data
    // CAP's own data arrives and is already EXTREME: first observation primes, and nothing fires.
    const first = evaluateSignals(ON, buildSnapshot(base({ ts: 3000 }))!, st);
    expect(first.events).toHaveLength(0);
    st = first.state;
    expect(evaluateSignals(ON, buildSnapshot(base({ ts: 4000 }))!, st).events).toHaveLength(0);
  });
});
