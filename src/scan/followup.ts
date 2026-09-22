/**
 * Compares a tracked signal's snapshot against fresh live data. Pure functions — the MCP server does
 * the fetching, this just judges what changed. Verdicts are descriptive, never "buy now" instructions.
 */
import type { Stage } from "@/scan/stage";

export interface ScanPickSnapshot {
  kind: "scan_pick";
  price: number;
  stage: Stage;
  trend: string;
  volatility: string;
  atrPercentile: number;
}

export interface RetestSnapshot {
  kind: "retest";
  price: number;
  level: { price: number; type: "support" | "resistance"; touches: number };
  direction: "bounce_up" | "bounce_down";
  confirmed: boolean;
  confirmedSignalCount: number;
}

export type TrackedSnapshot = ScanPickSnapshot | RetestSnapshot;

function pctChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

export interface ScanPickFollowup {
  priceChangePct: number;
  stageThen: Stage;
  stageNow: Stage;
  verdict: string;
}

export function evaluateScanPickFollowup(snapshot: ScanPickSnapshot, currentPrice: number, currentStage: Stage): ScanPickFollowup {
  const priceChangePct = pctChange(snapshot.price, currentPrice);
  const moved = Math.abs(priceChangePct) >= 0.1;
  const dir = priceChangePct >= 0 ? "up" : "down";
  const stageChanged = currentStage !== snapshot.stage;
  const verdict = `${moved ? `Price moved ${priceChangePct.toFixed(2)}% ${dir}` : "Price barely moved"} since logged` +
    (stageChanged ? `; stage went ${snapshot.stage} -> ${currentStage}` : `; still ${currentStage}`);
  return { priceChangePct, stageThen: snapshot.stage, stageNow: currentStage, verdict };
}

export interface RetestFollowup {
  priceChangePct: number;
  outcome: "held" | "invalidated" | "pending";
  verdict: string;
}

/** Buffer beyond which a move counts as held/invalidated rather than still-pending noise. */
const RETEST_BUFFER_PCT = 0.2;

export function evaluateRetestFollowup(snapshot: RetestSnapshot, currentPrice: number): RetestFollowup {
  const priceChangePct = pctChange(snapshot.price, currentPrice);
  const levelPrice = snapshot.level.price;
  const distFromLevelPct = pctChange(levelPrice, currentPrice);

  let outcome: RetestFollowup["outcome"];
  if (snapshot.direction === "bounce_up") {
    outcome = distFromLevelPct >= RETEST_BUFFER_PCT ? "held" : distFromLevelPct <= -RETEST_BUFFER_PCT ? "invalidated" : "pending";
  } else {
    outcome = distFromLevelPct <= -RETEST_BUFFER_PCT ? "held" : distFromLevelPct >= RETEST_BUFFER_PCT ? "invalidated" : "pending";
  }

  const verdict =
    outcome === "held"
      ? `Held: price is still on the confirmed side of the ${snapshot.level.type} (${distFromLevelPct.toFixed(2)}% away), ${priceChangePct.toFixed(2)}% since the touch.`
      : outcome === "invalidated"
        ? `Invalidated: price closed back through the ${snapshot.level.type} (${distFromLevelPct.toFixed(2)}% from it) — this is the fakeout case.`
        : `Still pending: price is within ${RETEST_BUFFER_PCT}% of the level, not enough movement yet to call it either way.`;

  return { priceChangePct, outcome, verdict };
}
