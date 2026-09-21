import { describe, expect, it } from "vitest";
import { LocalOrderBook, type DepthEvent } from "./localBook";
import { analyzeBook, fillPrice, findWalls, ladder, niceStep } from "./analysis";
import { WallTracker } from "./wallTracker";

const spotEv = (U: number, u: number, b: [number, number][] = [], a: [number, number][] = []): DepthEvent => ({
  U,
  u,
  b,
  a,
});
const perpEv = (
  U: number,
  u: number,
  pu: number,
  b: [number, number][] = [],
  a: [number, number][] = [],
): DepthEvent => ({ U, u, pu, b, a });
const snap = (id: number) => ({
  lastUpdateId: id,
  bids: [
    [100, 1],
    [99, 2],
  ] as [number, number][],
  asks: [
    [101, 1],
    [102, 2],
  ] as [number, number][],
});

describe("LocalOrderBook (spot)", () => {
  it("buffers, drops stale, bridges and applies", () => {
    const b = new LocalOrderBook("spot");
    expect(b.accept(spotEv(5, 8, [[100, 9]]))).toBe("buffered"); // fully before snapshot
    expect(b.accept(spotEv(9, 12, [[100, 3]]))).toBe("buffered"); // straddles 10+1
    expect(b.accept(spotEv(13, 14, [[98, 4]], [[101, 0]]))).toBe("buffered");
    expect(b.loadSnapshot(snap(10))).toBe("ok");
    const v = b.view();
    expect(v.bids).toEqual([
      [100, 3],
      [99, 2],
      [98, 4],
    ]);
    expect(v.asks).toEqual([[102, 2]]); // qty 0 removed level 101
    expect(b.accept(spotEv(15, 15, [[97, 1]]))).toBe("applied");
    expect(b.lastUpdateId).toBe(15);
  });
  it("detects a gap in the live chain", () => {
    const b = new LocalOrderBook("spot");
    b.loadSnapshot(snap(10));
    expect(b.accept(spotEv(11, 12))).toBe("applied");
    expect(b.accept(spotEv(14, 15))).toBe("gap"); // missed 13
  });
  it("snapshot older than the stream = gap (must refetch)", () => {
    const b = new LocalOrderBook("spot");
    b.accept(spotEv(50, 60));
    expect(b.loadSnapshot(snap(10))).toBe("gap");
    expect(b.synced).toBe(false);
  });
  it("ignores duplicate/old events after sync", () => {
    const b = new LocalOrderBook("spot");
    b.loadSnapshot(snap(10));
    b.accept(spotEv(11, 12));
    expect(b.accept(spotEv(11, 12))).toBe("stale");
  });
});

describe("LocalOrderBook (perp)", () => {
  it("first event must straddle, later events chain on pu", () => {
    const b = new LocalOrderBook("perp");
    b.accept(perpEv(8, 9, 7));
    b.accept(perpEv(10, 12, 9, [[100, 5]]));
    expect(b.loadSnapshot(snap(10))).toBe("ok");
    expect(b.view().bids[0]).toEqual([100, 5]);
    expect(b.accept(perpEv(13, 14, 12))).toBe("applied");
    expect(b.accept(perpEv(16, 17, 15))).toBe("gap");
  });
  it("crossed book flagged", () => {
    const b = new LocalOrderBook("perp");
    b.loadSnapshot(snap(10));
    b.accept(perpEv(10, 11, 9, [[105, 1]])); // straddles snapshot id 10
    expect(b.isCrossed()).toBe(true);
  });
});

describe("book analysis", () => {
  // mid = 100.05 ... use round numbers: bids 100,99.9..; asks 100.1,...
  const bids: [number, number][] = Array.from({ length: 50 }, (_, i) => [100 - i * 0.1, 10]);
  const asks: [number, number][] = Array.from({ length: 50 }, (_, i) => [100.1 + i * 0.1, 5]);
  const a = analyzeBook(bids, asks)!;
  it("mid/spread", () => {
    expect(a.mid).toBeCloseTo(100.05, 8);
    expect(a.spread).toBeCloseTo(0.1, 8);
    expect(a.spreadBps).toBeCloseTo((0.1 / 100.05) * 1e4, 6);
  });
  it("bid-heavy book → positive imbalance; bands flag incomplete coverage", () => {
    const b1 = a.bands.find((b) => b.pct === 0.25)!;
    expect(b1.imbalance).toBeGreaterThan(0);
    expect(b1.complete).toBe(true);
    expect(a.bands.find((b) => b.pct === 5)!.complete).toBe(false); // book only spans ~5%*... 4.9% one side
  });
  it("fillPrice walks levels", () => {
    // 100 USD: 1 unit @ 100.1 = 100.1 > 100 → all in first level
    expect(
      fillPrice(
        [
          [100, 1],
          [101, 1],
        ],
        100,
      ),
    ).toBeCloseTo(100, 10);
    // 150 USD: 100 @100 + 50 @101
    const px = fillPrice(
      [
        [100, 1],
        [101, 1],
      ],
      150,
    )!;
    expect(px).toBeCloseTo(150 / (1 + 50 / 101), 8);
    expect(fillPrice([[100, 1]], 500)).toBeNull();
  });
  it("slippage grows with size; unfillable is null", () => {
    const deepA = analyzeBook(
      bids.map((l) => [l[0], 500] as [number, number]),
      asks.map((l) => [l[0], 500] as [number, number]),
    )!;
    const s = deepA.impacts;
    expect(s[1].buySlippageBps!).toBeGreaterThanOrEqual(s[0].buySlippageBps!);
    expect(s[2].buySlippageBps!).toBeGreaterThanOrEqual(s[1].buySlippageBps!);
    expect(a.impacts[3].buySlippageBps).toBeNull(); // $500k > ~$25k of asks in the thin book
    expect(a.rating).toBe("LOW");
  });
  it("crossed / empty → null", () => {
    expect(analyzeBook([[101, 1]], [[100, 1]])).toBeNull();
    expect(analyzeBook([], [[100, 1]])).toBeNull();
  });
  it("finds only outsized levels as walls", () => {
    const bs: [number, number][] = bids.map((l, i) => (i === 7 ? [l[0], 500] : l));
    const walls = findWalls(bs, asks, 100.05);
    expect(walls).toHaveLength(1);
    expect(walls[0].side).toBe("bid");
    expect(walls[0].multiple).toBeGreaterThan(6);
    expect(findWalls(bids, asks, 100.05)).toHaveLength(0);
  });
});

describe("ladder", () => {
  it("niceStep", () => {
    expect(niceStep(8.1)).toBe(10);
    expect(niceStep(0.0012)).toBeCloseTo(0.001);
    expect(niceStep(2.2)).toBe(2);
  });
  it("buckets bids down and asks up with cumulative", () => {
    const l = ladder(
      [
        [100.4, 1],
        [100.1, 1],
        [99.9, 1],
      ],
      "bid",
      1,
      5,
    );
    expect(l.map((r) => r.price)).toEqual([100, 99]);
    expect(l[0].usd).toBeCloseTo(100.4 + 100.1, 8);
    expect(l[1].cumUsd).toBeCloseTo(100.4 + 100.1 + 99.9, 8);
    const s = ladder(
      [
        [100.1, 1],
        [100.9, 1],
      ],
      "ask",
      1,
      5,
    );
    expect(s.map((r) => r.price)).toEqual([101]);
  });
});

describe("WallTracker", () => {
  const wall = (price: number, side: "bid" | "ask" = "bid") => ({
    side,
    price,
    usd: 100_000,
    distancePct: 0,
    multiple: 10,
  });
  it("reports appeared, then pulled when price never reached it", () => {
    const t = new WallTracker(3);
    expect(t.update([wall(95)], 100, 0).map((e) => e.kind)).toEqual(["appeared"]);
    t.update([wall(95)], 100, 5_000);
    const ev = t.update([], 100, 10_000);
    expect(ev.map((e) => e.kind)).toEqual(["pulled"]);
    expect(ev[0].lifetimeSec).toBe(10);
  });
  it("consumed when price reached the wall", () => {
    const t = new WallTracker(3);
    t.update([wall(95)], 100, 0);
    expect(t.update([], 95.01, 10_000).map((e) => e.kind)).toEqual(["consumed"]);
  });
  it("ignores sub-threshold flicker", () => {
    const t = new WallTracker(3);
    t.update([wall(95)], 100, 0);
    expect(t.update([], 100, 1_000)).toEqual([]);
  });
  it("wall on the same price different side is distinct", () => {
    const t = new WallTracker(3);
    t.update([wall(95, "bid"), wall(95, "ask")], 100, 0);
    expect(t.active(1000)).toHaveLength(2);
  });
});
