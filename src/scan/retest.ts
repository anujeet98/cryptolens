/**
 * Detects a recent support/resistance retest and scores it against independent confirmation signals.
 *
 * No signal combination here proves a retest will hold — fakeouts happen regardless of how many
 * indicators agree. This only stacks evidence so a "confirmed" retest is more than "price touched a
 * line and closed on the right side of it": the rejection candle is mandatory, plus at least 2 of 4
 * independent checks (volume, momentum, stage, RSI failure swing) must agree with the bounce direction.
 */
import { computeMomentum } from "@/analysis/momentum";
import { computeTechnicals } from "@/analysis/technicals";
import { analyzeVolume } from "@/analysis/volume";
import { classifyRegime } from "@/regime/regime";
import { classifyStage } from "@/scan/stage";
import { findLevels, type Level } from "@/scan/levels";
import type { Candle, Timeframe } from "@/types/market";

const TF_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export type BounceDirection = "bounce_up" | "bounce_down"; // bounce_up = support held (bullish); bounce_down = resistance held (bearish)

export interface RetestSignal {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface RetestResult {
  level: Level;
  direction: BounceDirection;
  barsAgo: number;
  touchPrice: number;
  currentPrice: number;
  signals: RetestSignal[];
  confirmedSignalCount: number; // out of the 4 optional signals
  confirmed: boolean; // rejection candle (mandatory) + confirmedSignalCount >= 2
}

export interface RetestOptions {
  /** How many of the most recent closed candles to scan for a touch event. */
  lookbackBars?: number;
  /** Minimum prior touches for a level to count as "established" before this event. */
  minTouches?: number;
  pivotWindow?: number;
  clusterAtrMult?: number;
}

function touchTolerance(level: Level, candles: Candle[]): number {
  // Same tolerance basis as level clustering: generous enough to catch a wick, tight enough to mean something.
  const recentRange = candles.slice(-20).reduce((s, c) => s + (c.high - c.low), 0) / Math.min(20, candles.length);
  return Math.max(level.price * 0.001, recentRange * 0.5);
}

/** Finds the most recent closed-candle touch of an established level with a rejection close, and scores it. */
export function detectRetest(candles: Candle[], tf: Timeframe, opts: RetestOptions = {}): RetestResult | null {
  const { lookbackBars = 5, minTouches = 2, pivotWindow = 3, clusterAtrMult = 0.5 } = opts;
  const closed = candles.filter((c) => c.closed);
  if (closed.length < 90) return null;

  const levels = findLevels(closed, { pivotWindow, clusterAtrMult }).filter((l) => l.touches >= minTouches);
  if (!levels.length) return null;

  for (let i = closed.length - 1; i >= Math.max(0, closed.length - lookbackBars); i--) {
    const bar = closed[i];
    for (const level of levels) {
      if (level.lastTouchIndex >= i) continue; // level must be established before this bar, not by it
      const tol = touchTolerance(level, closed.slice(0, i + 1));

      const touchedSupportFromAbove = bar.low <= level.price + tol && bar.low >= level.price - tol * 8;
      const rejectedUp = touchedSupportFromAbove && bar.close > level.price;
      const touchedResistanceFromBelow = bar.high >= level.price - tol && bar.high <= level.price + tol * 8;
      const rejectedDown = touchedResistanceFromBelow && bar.close < level.price;

      if (level.type === "support" && rejectedUp) {
        return score(closed, i, level, "bounce_up", tf);
      }
      if (level.type === "resistance" && rejectedDown) {
        return score(closed, i, level, "bounce_down", tf);
      }
    }
  }
  return null;
}

function score(closed: Candle[], touchIndex: number, level: Level, direction: BounceDirection, tf: Timeframe): RetestResult {
  const asOf = closed.slice(0, touchIndex + 1);
  const touchBar = closed[touchIndex];
  const bullish = direction === "bounce_up";

  const signals: RetestSignal[] = [];

  const vol = analyzeVolume(asOf, tf, touchBar.time * 1000 + TF_MS[tf] + 1000);
  signals.push({
    key: "volume",
    label: "Volume confirms",
    pass: !!vol && vol.state !== "CLIMAX" && vol.effectiveRelative >= 1,
    detail: vol
      ? `state ${vol.state}, ${vol.effectiveRelative.toFixed(2)}x average`
      : "not enough history to compute volume state",
  });

  const mom = computeMomentum(asOf);
  const momPass = !!mom && (bullish ? mom.direction === "BULLISH" : mom.direction === "BEARISH") && mom.trend === "ACCELERATING";
  signals.push({
    key: "momentum",
    label: "Momentum flipping with the bounce",
    pass: momPass,
    detail: mom ? `${mom.condition}, score ${mom.score.toFixed(0)}` : "not enough history to compute momentum",
  });

  const regime = classifyRegime(asOf, tf);
  const stage = regime ? classifyStage(regime) : null;
  signals.push({
    key: "stage",
    label: "Range starting to widen (igniting), not just touching",
    pass: stage === "igniting",
    detail: stage ? `stage: ${stage}` : "not enough history to classify regime",
  });

  const tech = computeTechnicals(asOf);
  const failureSwingPass = !!tech && tech.rsiFailureSwing === (bullish ? "bullish" : "bearish");
  signals.push({
    key: "rsi_failure_swing",
    label: "RSI failure swing agrees with the bounce",
    pass: failureSwingPass,
    detail: tech?.rsiFailureSwing ? `rsiFailureSwing: ${tech.rsiFailureSwing}` : "no RSI failure swing detected",
  });

  const confirmedSignalCount = signals.filter((s) => s.pass).length;
  const currentPrice = closed[closed.length - 1].close;

  return {
    level,
    direction,
    barsAgo: closed.length - 1 - touchIndex,
    touchPrice: touchBar.close,
    currentPrice,
    signals,
    confirmedSignalCount,
    confirmed: confirmedSignalCount >= 2, // rejection candle is mandatory to reach this function at all
  };
}
