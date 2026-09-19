import { describe, expect, it } from "vitest";
import { COOLDOWN_MS, REARM_MS, conditionOf, emptyState, evaluateLevels, evaluateSignals, trailingRangePct, type LevelRule, type Snapshot } from "./engine";
import { RISK_TABLE } from "@/risk/forecast";
import type { Candle } from "@/types/market";

const T0 = 1_700_000_000_000;
const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  symbol: "BTCUSDT", tf: "15m", ts: T0, volatility: "NORMAL", atrPct: 0.2, trailingRangePct: 0.3, liqBurst: { active: false, dominant: null, lastMinUsd: 0, avgMinUsd: 0 }, fundingClass: "NEUTRAL", ...o,
});
const ON = { "vol-extreme": true, "range-spike": true, "liq-burst": true, "funding-extreme": true } as const;
const cd = (open: number, high: number, low: number, close: number): Candle => ({ time: 0, open, high, low, close, volume: 1, quoteVolume: 1, closed: true });

describe("trailingRangePct", () => {
  it("is high-low of the last n bars over the first open, in percent", () => {
    const c = [cd(1, 1, 1, 1), cd(100, 101, 99, 100), cd(100, 103, 100, 102), cd(102, 102, 98, 99), cd(99, 100, 97, 98)];
    expect(trailingRangePct(c, 4)).toBeCloseTo(((103 - 97) / 100) * 100, 12); // ignores the oldest bar
    expect(trailingRangePct(c.slice(0, 2), 4)).toBeNull();
  });
});

describe("conditionOf", () => {
  it("returns null when inputs are missing, so absence is never mistaken for 'clear'", () => {
    expect(conditionOf("vol-extreme", snap({ volatility: null }))).toBeNull();
    expect(conditionOf("range-spike", snap({ atrPct: null }))).toBeNull();
    expect(conditionOf("range-spike", snap({ atrPct: 0 }))).toBeNull();
    expect(conditionOf("liq-burst", snap({ liqBurst: null }))).toBeNull();
    expect(conditionOf("funding-extreme", snap({ fundingClass: null }))).toBeNull();
  });
  it("range-spike triggers at the historical 90th percentile multiple of ATR", () => {
    const atr = 0.2, thr = RISK_TABLE[4].p90 * atr;
    expect(conditionOf("range-spike", snap({ atrPct: atr, trailingRangePct: thr * 0.99 }))).toBe(false);
    expect(conditionOf("range-spike", snap({ atrPct: atr, trailingRangePct: thr }))).toBe(true);
  });
  it("funding triggers on both extremes and not on mild values", () => {
    expect(conditionOf("funding-extreme", snap({ fundingClass: "EXTREMELY_POSITIVE" }))).toBe(true);
    expect(conditionOf("funding-extreme", snap({ fundingClass: "EXTREMELY_NEGATIVE" }))).toBe(true);
    expect(conditionOf("funding-extreme", snap({ fundingClass: "POSITIVE" }))).toBe(false);
  });
});

describe("evaluateSignals", () => {
  it("primes on the first observation and does not fire for a state that was already true", () => {
    const r = evaluateSignals(ON, snap({ volatility: "EXTREME" }), emptyState());
    expect(r.events).toHaveLength(0);
    expect(r.state.signals["vol-extreme"]!.active).toBe(true);
    // still true a minute later: still silent
    expect(evaluateSignals(ON, snap({ volatility: "EXTREME", ts: T0 + 60_000 }), r.state).events).toHaveLength(0);
  });

  it("fires when a condition turns true, once, with a useful message", () => {
    let st = evaluateSignals(ON, snap(), emptyState()).state;
    const r = evaluateSignals(ON, snap({ volatility: "EXTREME", ts: T0 + 1000 }), st);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].kind).toBe("vol-extreme");
    expect(r.events[0].title).toContain("EXTREME");
    expect(r.events[0].detail).toContain("Direction unknown");
    st = r.state;
    expect(evaluateSignals(ON, snap({ volatility: "EXTREME", ts: T0 + 2000 }), st).events).toHaveLength(0); // does not repeat while true
  });

  it("does not fire a disabled rule, but still tracks it so enabling later is not a false alarm", () => {
    let st = evaluateSignals({ ...ON, "vol-extreme": false }, snap(), emptyState()).state;
    const r = evaluateSignals({ ...ON, "vol-extreme": false }, snap({ volatility: "EXTREME", ts: T0 + 1000 }), st);
    expect(r.events).toHaveLength(0);
    st = r.state;
    expect(evaluateSignals(ON, snap({ volatility: "EXTREME", ts: T0 + 2000 }), st).events).toHaveLength(0); // already true when enabled
  });

  it("needs the condition to stay false for REARM_MS before it can fire again, and respects the cooldown", () => {
    let st = evaluateSignals(ON, snap(), emptyState()).state;
    let t = T0 + 1000;
    st = evaluateSignals(ON, snap({ volatility: "EXTREME", ts: t }), st).state; // fires
    // brief dip below EXTREME (flicker at the threshold), then back: must NOT fire again
    t += 10_000; st = evaluateSignals(ON, snap({ volatility: "HIGH", ts: t }), st).state;
    t += 10_000;
    expect(evaluateSignals(ON, snap({ volatility: "EXTREME", ts: t }), st).events).toHaveLength(0);
    // a sustained clear: false for longer than REARM_MS AND past the cooldown
    st = evaluateSignals(ON, snap({ volatility: "HIGH", ts: t + 1000 }), st).state;
    t += COOLDOWN_MS + REARM_MS;
    st = evaluateSignals(ON, snap({ volatility: "HIGH", ts: t }), st).state; // releases the latch
    const again = evaluateSignals(ON, snap({ volatility: "EXTREME", ts: t + 1000 }), st);
    expect(again.events).toHaveLength(1);
  });

  it("does not re-fire inside the cooldown even after a full re-arm", () => {
    let st = evaluateSignals(ON, snap(), emptyState()).state;
    let t = T0 + 1000;
    st = evaluateSignals(ON, snap({ volatility: "EXTREME", ts: t }), st).state; // fires at t
    t += 1000; st = evaluateSignals(ON, snap({ volatility: "HIGH", ts: t }), st).state;
    t += REARM_MS + 1000; st = evaluateSignals(ON, snap({ volatility: "HIGH", ts: t }), st).state; // re-armed
    expect(t - (T0 + 1000)).toBeLessThan(COOLDOWN_MS);
    expect(evaluateSignals(ON, snap({ volatility: "EXTREME", ts: t + 1000 }), st).events).toHaveLength(0); // cooling down
  });

  it("switching coin or timeframe re-primes: an EXTREME coin you just opened does not alarm", () => {
    let st = evaluateSignals(ON, snap(), emptyState()).state; // BTC calm
    const eth = evaluateSignals(ON, snap({ symbol: "ETHUSDT", volatility: "EXTREME", ts: T0 + 1000 }), st);
    expect(eth.events).toHaveLength(0);
    expect(eth.state.context).toBe("ETHUSDT:15m");
    st = eth.state;
    const tf = evaluateSignals(ON, snap({ symbol: "ETHUSDT", tf: "1h", volatility: "EXTREME", ts: T0 + 2000 }), st);
    expect(tf.events).toHaveLength(0);
  });

  it("missing data neither fires nor clears", () => {
    let st = evaluateSignals(ON, snap({ volatility: "EXTREME" }), emptyState()).state;
    st = evaluateSignals(ON, snap({ volatility: null, ts: T0 + 1000 }), st).state; // regime briefly unavailable
    expect(st.signals["vol-extreme"]!.active).toBe(true); // still latched
  });

  it("fires independent rules independently", () => {
    const st = evaluateSignals(ON, snap(), emptyState()).state;
    const r = evaluateSignals(ON, snap({ fundingClass: "EXTREMELY_POSITIVE", liqBurst: { active: true, dominant: "long", lastMinUsd: 250_000, avgMinUsd: 20_000 }, ts: T0 + 1000 }), st);
    expect(r.events.map((e) => e.kind).sort()).toEqual(["funding-extreme", "liq-burst"]);
    expect(r.events.find((e) => e.kind === "liq-burst")!.detail).toContain("Longs");
    expect(r.events.find((e) => e.kind === "funding-extreme")!.detail).toContain("not yet backtested");
  });
});

describe("evaluateLevels", () => {
  const rule = (o: Partial<LevelRule> = {}): LevelRule => ({ id: "r1", symbol: "BTCUSDT", market: "perp", level: 100, dir: "above", createdAt: 0, ...o });
  const K = "BTCUSDT:perp";

  it("fires when price crosses between two observations, in either direction, and not before", () => {
    expect(evaluateLevels([rule()], { [K]: 99 }, { [K]: 98 }, T0).events).toHaveLength(0);
    const up = evaluateLevels([rule()], { [K]: 101 }, { [K]: 99 }, T0);
    expect(up.firedIds).toEqual(["r1"]);
    expect(up.events[0].title).toContain("rose above 100");
    const dn = evaluateLevels([rule({ dir: "below" })], { [K]: 99 }, { [K]: 101 }, T0);
    expect(dn.events[0].title).toContain("fell below 100");
  });

  it("catches a jump straight over the level between polls", () => {
    expect(evaluateLevels([rule()], { [K]: 130 }, { [K]: 90 }, T0).firedIds).toEqual(["r1"]);
  });

  it("needs a previous price, so the first observation only records; a level already passed does not fire", () => {
    const first = evaluateLevels([rule()], { [K]: 150 }, {}, T0);
    expect(first.events).toHaveLength(0);
    expect(first.lastPrices[K]).toBe(150);
    expect(evaluateLevels([rule()], { [K]: 151 }, first.lastPrices, T0).events).toHaveLength(0); // already above, no crossing
  });

  it("ignores coins with no fresh price and keeps other coins' last prices", () => {
    const r = evaluateLevels([rule({ id: "e", symbol: "ETHUSDT", level: 5 })], { [K]: 101 }, { [K]: 99, "ETHUSDT:perp": 4 }, T0);
    expect(r.events).toHaveLength(0);
    expect(r.lastPrices["ETHUSDT:perp"]).toBe(4);
    expect(r.lastPrices[K]).toBe(101);
  });

  it("touching the level exactly counts as crossing", () => {
    expect(evaluateLevels([rule()], { [K]: 100 }, { [K]: 99.5 }, T0).firedIds).toEqual(["r1"]);
  });
});
