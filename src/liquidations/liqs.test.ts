import { describe, expect, it } from "vitest";
import { LiqStore, parseForceOrder, type LiqEvent } from "./liqs";

const T0 = 1_700_000_000_000;
const ev = (dtSec: number, usd: number, side: "long" | "short", symbol = "BTCUSDT"): LiqEvent => ({ t: T0 + dtSec * 1000, symbol, side, price: 100, usd });

describe("parseForceOrder", () => {
  const base = { s: "CAPUSDT", S: "BUY", p: "0.0718", ap: "0.0642105", z: "18182", q: "18182", T: T0 };
  it("uses average fill price and filled qty; BUY order = short liquidated", () => {
    const e = parseForceOrder({ o: base })!;
    expect(e.side).toBe("short");
    expect(e.usd).toBeCloseTo(0.0642105 * 18182, 6);
    expect(e.symbol).toBe("CAPUSDT");
  });
  it("SELL order = long liquidated; falls back to limit price/qty when fill data is zero", () => {
    const e = parseForceOrder({ o: { ...base, S: "SELL", ap: "0", z: "0", p: "2", q: "10" } })!;
    expect(e.side).toBe("long");
    expect(e.usd).toBe(20);
  });
  it("rejects malformed payloads", () => {
    expect(parseForceOrder({})).toBeNull();
    expect(parseForceOrder({ o: { ...base, ap: "abc", p: "abc" } })).toBeNull();
  });
});

describe("LiqStore", () => {
  it("windows split long/short, filter by symbol and by time", () => {
    const s = new LiqStore();
    s.add(ev(0, 1000, "long"));
    s.add(ev(10, 3000, "short"));
    s.add(ev(20, 9999, "long", "ETHUSDT"));
    s.add(ev(400, 500, "long")); // outside 5m of `now` below, inside 15m
    const now = T0 + 500_000;
    const snap = s.snapshot(now, "BTCUSDT", T0);
    const w5 = snap.windows.find((w) => w.label === "5m")!;
    const w15 = snap.windows.find((w) => w.label === "15m")!;
    expect(w5.longUsd).toBe(500);
    expect(w5.shortUsd).toBe(0);
    expect(w15.longUsd).toBe(1500);
    expect(w15.shortUsd).toBe(3000);
    expect(w15.count).toBe(3);
    expect(w15.largest).toBe(3000);
    expect(w15.covered).toBe(false); // only ~500s collected vs 900s
    expect(w5.covered).toBe(true);
  });

  it("market-wide totals and top list include all symbols, ranked by size", () => {
    const s = new LiqStore();
    s.add(ev(0, 1000, "long", "AAAUSDT"));
    s.add(ev(1, 5000, "short", "BBBUSDT"));
    s.add(ev(2, 2000, "long", "AAAUSDT"));
    const snap = s.snapshot(T0 + 10_000, null, T0);
    expect(snap.market.count).toBe(3);
    expect(snap.market.longUsd).toBe(3000);
    expect(snap.market.shortUsd).toBe(5000);
    expect(snap.market.top.map((t) => t.symbol)).toEqual(["BBBUSDT", "AAAUSDT"]);
    expect(snap.windows[0].count).toBe(0); // no selected symbol
  });

  it("detects a burst only with enough history and a real spike", () => {
    const s = new LiqStore();
    for (let m = 0; m < 20; m++) s.add(ev(m * 60, 2000, "long")); // ~$2k/min baseline
    const calm = s.snapshot(T0 + 20 * 60_000, "BTCUSDT", T0);
    expect(calm.burst.active).toBe(false);
    s.add(ev(20 * 60 + 5, 120_000, "long"));
    const spike = s.snapshot(T0 + 20 * 60_000 + 10_000, "BTCUSDT", T0);
    expect(spike.burst.active).toBe(true);
    expect(spike.burst.dominant).toBe("long");
    const early = s.snapshot(T0 + 20 * 60_000 + 10_000, "BTCUSDT", T0 + 20 * 60_000 - 100_000);
    expect(early.burst.active).toBe(false); // < 5 min of collection: no burst claims
  });

  it("expires events older than an hour and caps memory", () => {
    const s = new LiqStore();
    s.add(ev(0, 1000, "long"));
    s.add(ev(3700, 1000, "long"));
    const snap = s.snapshot(T0 + 3700_000, "BTCUSDT", T0);
    expect(snap.windows.find((w) => w.label === "1h")!.count).toBe(1);
    const big = new LiqStore();
    for (let i = 0; i < 20_500; i++) big.add(ev(0, 1, "long"));
    expect(big.snapshot(T0 + 1000, "BTCUSDT", T0).windows[2].count).toBe(20_000);
  });
});
