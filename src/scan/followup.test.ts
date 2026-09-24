import { describe, expect, it } from "vitest";
import { evaluateRetestFollowup, evaluateScanPickFollowup, type RetestSnapshot, type ScanPickSnapshot } from "./followup";

describe("evaluateScanPickFollowup", () => {
  const snapshot: ScanPickSnapshot = { kind: "scan_pick", price: 100, stage: "igniting", trend: "UPTREND", volatility: "HIGH", atrPercentile: 90 };

  it("reports price change and an unchanged stage", () => {
    const r = evaluateScanPickFollowup(snapshot, 102, "igniting");
    expect(r.priceChangePct).toBeCloseTo(2, 5);
    expect(r.stageThen).toBe("igniting");
    expect(r.stageNow).toBe("igniting");
    expect(r.verdict).toContain("2.00% up");
    expect(r.verdict).toContain("still igniting");
  });

  it("flags a stage transition, e.g. igniting cooling into extended", () => {
    const r = evaluateScanPickFollowup(snapshot, 103, "extended");
    expect(r.verdict).toContain("igniting -> extended");
  });
});

describe("evaluateRetestFollowup", () => {
  const bounceUp: RetestSnapshot = {
    kind: "retest",
    price: 101,
    level: { price: 100, type: "support", touches: 3 },
    direction: "bounce_up",
    confirmed: true,
    confirmedSignalCount: 3,
  };

  it("calls a support bounce held once price is clearly above the level", () => {
    const r = evaluateRetestFollowup(bounceUp, 103);
    expect(r.outcome).toBe("held");
  });

  it("calls a support bounce invalidated once price closes back below the level", () => {
    const r = evaluateRetestFollowup(bounceUp, 99.5);
    expect(r.outcome).toBe("invalidated");
    expect(r.verdict).toContain("fakeout");
  });

  it("calls it pending when price is still within the buffer of the level", () => {
    const r = evaluateRetestFollowup(bounceUp, 100.1);
    expect(r.outcome).toBe("pending");
  });

  it("mirrors the logic for a resistance rejection (bounce_down)", () => {
    const bounceDown: RetestSnapshot = { ...bounceUp, level: { price: 100, type: "resistance", touches: 3 }, direction: "bounce_down" };
    expect(evaluateRetestFollowup(bounceDown, 97).outcome).toBe("held");
    expect(evaluateRetestFollowup(bounceDown, 101).outcome).toBe("invalidated");
    expect(evaluateRetestFollowup(bounceDown, 100.05).outcome).toBe("pending");
  });
});
