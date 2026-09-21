import { describe, expect, it } from "vitest";
import { MinuteAggregator } from "./aggregate";

const T = 1_700_000_040_000; // exactly on a minute boundary (1_700_000_040 % 60 === 0)
const s = (sec: number) => T + sec * 1000;

describe("MinuteAggregator", () => {
  it("buckets by exchange time and computes OHLC, flow and largest prints", () => {
    const a = new MinuteAggregator();
    a.add(s(1), 100, 1000, true);
    a.add(s(20), 103, 4000, false);
    a.add(s(40), 99, 500, true);
    a.add(s(59), 101, 2500, false);
    a.add(s(61), 200, 700, true); // next minute
    const out = a.flush(s(125)); // both minutes elapsed
    expect(out).toHaveLength(2);
    const m = out[0];
    expect(m.ts).toBe(T / 1000);
    expect([m.open, m.high, m.low, m.close]).toEqual([100, 103, 99, 101]);
    expect(m.buyUsd).toBe(1500);
    expect(m.sellUsd).toBe(6500);
    expect([m.buyN, m.sellN]).toEqual([2, 2]);
    expect([m.maxBuyUsd, m.maxSellUsd]).toEqual([1000, 4000]);
    expect(m.gap).toBe(false);
    expect(out[1].ts).toBe(T / 1000 + 60);
  });

  it("does not emit a minute that is still open", () => {
    const a = new MinuteAggregator();
    a.add(s(10), 100, 1000, true);
    expect(a.flush(s(59))).toHaveLength(0);
    expect(a.flush(s(60))).toHaveLength(1);
  });

  it("seals flushed minutes: a straggler cannot resurrect them", () => {
    const a = new MinuteAggregator();
    a.add(s(10), 100, 1000, true);
    expect(a.flush(s(70))).toHaveLength(1);
    expect(a.add(s(30), 100, 999, true)).toBe(false); // late trade for the sealed minute
    expect(a.flush(s(130))).toHaveLength(0); // nothing re-emitted
  });

  it("flags every minute touched by an outage, including silent ones, and clears afterwards", () => {
    const a = new MinuteAggregator();
    a.add(s(10), 100, 1000, true);
    a.markDown(s(50)); // down during minute 0
    a.markUp(s(190)); // back in minute 3; minutes 1 and 2 saw nothing
    a.add(s(200), 101, 300, true);
    const out = a.flush(s(300));
    expect(out.map((m) => [m.ts - T / 1000, m.gap])).toEqual([
      [0, true],
      [60, true],
      [120, true],
      [180, true],
    ]);
    expect(out[1].open).toBeNull(); // silent minute: zero flow, no prices
    expect(out[1].buyUsd + out[1].sellUsd).toBe(0);
    a.add(s(310), 102, 100, true);
    expect(a.flush(s(400)).every((m) => !m.gap)).toBe(true); // outage does not leak into later minutes
  });

  it("flags elapsed minutes while the stream is still down", () => {
    const a = new MinuteAggregator();
    a.markDown(s(10));
    const out = a.flush(s(130));
    expect(out.map((m) => m.gap)).toEqual([true, true]);
  });
});
