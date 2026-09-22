/**
 * Classifies where a coin sits in the volatility cycle, not just how volatile it currently is.
 *
 * A high ATR percentile alone doesn't distinguish "just started moving" from "already moved and now
 * cooling off" — and per the project's own backtests + notes, entries into the latter carry real
 * reversal risk (the site's context text: "volatility... tended to settle back below what the current
 * ATR implies"). This uses volTrend (is the range still widening right now?) and `stalled` (is the
 * trend label lagging a move that already stopped?) to separate the two.
 */
import type { Regime } from "@/regime/regime";

export type Stage = "coiled" | "igniting" | "extended" | "exhausted";

export const STAGE_PRIORITY: Record<Stage, number> = {
  igniting: 0, // range is actively widening right now, not yet at an extreme — the "next few minutes" case
  coiled: 1, // compressed (squeeze/low), hasn't broken out yet — timing unconfirmed, don't assume "soon"
  extended: 2, // already at a volatility extreme and no longer widening — the move likely already happened
  exhausted: 3, // trend label is lagging a move that has stalled, or a high-vol state is now contracting
};

export const STAGE_LABEL: Record<Stage, string> = {
  igniting: "Range actively widening now, not yet extreme — a move may be in progress.",
  coiled: "Compressed / squeeze — energy for a move exists but timing and direction are unconfirmed.",
  extended: "Already at a volatility extreme and no longer widening — the move has likely already happened.",
  exhausted: "Trend label is lagging a move that has stalled, or a high-vol state is now cooling off — reversal risk.",
};

export function classifyStage(r: Regime): Stage {
  const highVol = r.volatility === "HIGH" || r.volatility === "EXTREME";

  if (r.stalled || (highVol && r.volTrend === "CONTRACTING")) return "exhausted";
  if (highVol && r.volTrend !== "EXPANDING") return "extended";
  if (r.volatility === "SQUEEZE" || r.volatility === "LOW") return "coiled";
  if (r.volTrend === "EXPANDING" && !r.stalled) return "igniting";
  return "extended"; // steady mid-volatility with nothing building: treat as already-played-out, not a fresh setup
}
