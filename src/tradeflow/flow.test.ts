import { describe, expect, it } from "vitest";
import { FlowStore, classify } from "./flow";

const T0 = 1_700_000_000_000;
const tr = (dtSec: number, price: number, usd: number, buy: boolean) => ({ t: T0 + dtSec * 1000, price, usd, buy });

describe("classify", () => {
  it("flags balanced, dominant and absorption cases", () => {
    expect(classify(50, 0, 1000, 0)).toBe("BALANCED");
    expect(classify(65, 300, 1000, 0.2)).toBe("BUYERS");
    expect(classify(35, -300, 1000, -0.2)).toBe("SELLERS");
    expect(classify(65, 300, 1000, -0.1)).toBe("ABSORPTION_BUY");
    expect(classify(35, -300, 1000, 0.1)).toBe("ABSORPTION_SELL");
    expect(classify(70, 400, 0, 0)).toBe("BALANCED"); // no volume
  });
});

describe("FlowStore", () => {
  it("sums taker volume, delta and CVD per window", () => {
    const s = new FlowStore();
    s.add(tr(0, 100, 1000, true));
    s.add(tr(1, 101, 3000, false));
    s.add(tr(20, 102, 2000, true));
    const snap = s.snapshot(T0 + 25_000);
    const w = snap.windows.find((x) => x.label === "30s")!;
    expect(w.buyUsd).toBe(3000);
    expect(w.sellUsd).toBe(3000);
    expect(w.deltaUsd).toBe(0);
    expect(w.trades).toBe(3);
    expect(w.priceChangePct).toBeCloseTo(2, 5); // 100 -> 102
    expect(snap.cvd).toBe(0);
    expect(w.covered).toBe(false); // only ~26s collected vs a 30s window
  });

  it("excludes trades outside the window and expires old buckets", () => {
    const s = new FlowStore();
    s.add(tr(0, 100, 5000, true));
    s.add(tr(100, 100, 1000, false));
    const snap = s.snapshot(T0 + 100_000);
    expect(snap.windows.find((x) => x.label === "1m")!.buyUsd).toBe(0);
    expect(snap.windows.find((x) => x.label === "5m")!.buyUsd).toBe(5000);
    s.add(tr(1000, 100, 1000, true)); // 1000s later: first two buckets fall out of the 15m store
    const later = s.snapshot(T0 + 1000_000);
    expect(later.windows.find((x) => x.label === "15m")!.trades).toBe(1);
    expect(later.cvd).toBe(5000 - 1000 + 1000); // CVD is cumulative since connect, not windowed
  });

  it("scales the large threshold at 30x average trade size, with a $10k floor", () => {
    const small = new FlowStore();
    for (let i = 0; i < 50; i++) small.add(tr(i, 100, 100, i % 2 === 0));
    expect(small.largeThreshold()).toBe(10_000); // 30 x $100 = $3k, floored
    const big = new FlowStore();
    for (let i = 0; i < 50; i++) big.add(tr(i, 100, 500, i % 2 === 0));
    expect(big.largeThreshold()).toBe(15_000); // 30 x $500
  });

  it("captures a big print on the tape", () => {
    const s = new FlowStore();
    for (let i = 0; i < 50; i++) s.add(tr(i, 100, 500, true));
    s.add(tr(51, 100, 200_000, false));
    const snap = s.snapshot(T0 + 52_000);
    expect(snap.large).toHaveLength(1);
    expect(snap.large[0].buy).toBe(false);
    expect(snap.largeSellUsd).toBe(200_000);
    expect(snap.largeBuyUsd).toBe(0);
  });

  it("builds a monotonic-in-time CVD series ending at the CVD total", () => {
    const s = new FlowStore();
    s.add(tr(0, 100, 1000, true));
    s.add(tr(1, 100, 400, false));
    s.add(tr(2, 100, 200, true));
    const snap = s.snapshot(T0 + 3000);
    expect(snap.cvdSeries.map((p) => p.v)).toEqual([1000, 600, 800]);
    expect(snap.cvdSeries.at(-1)!.v).toBe(snap.cvd);
  });
});
