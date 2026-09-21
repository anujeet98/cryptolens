import type { Series } from "@/indicators";
import type { Candle } from "@/types/market";

/** Aligns a sparse time series to candles as a step function: each candle gets the latest point known at its close. */
export function alignStep<T extends { time: number }>(
  candles: Candle[],
  points: T[],
  candleSec: number,
  pick: (p: T) => number,
): Series {
  const out: Series = new Array(candles.length).fill(null);
  let j = -1;
  for (let i = 0; i < candles.length; i++) {
    const t = candles[i].time + candleSec;
    while (j + 1 < points.length && points[j + 1].time <= t) j++;
    out[i] = j >= 0 ? pick(points[j]) : null;
  }
  return out;
}
