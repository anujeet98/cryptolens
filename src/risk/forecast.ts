import type { VolRegime } from "@/regime/regime";

/**
 * Expected price range over the next h bars, as multiples of the current ATR%. "Range" = highest high minus lowest low
 * over the window, relative to the entry open. It is direction-free: it says how far price tends to travel, not which way.
 *
 * Calibrated by `npm run calibrate-risk` on ~2 years of Binance perp candles (BTC, ETH, SOL) on 15m, 1h and 4h: the
 * quantiles of (forward range / ATR%) over ALL observations, averaged with equal weight across the three timeframes.
 * The multiples were nearly identical across timeframes (e.g. 4-bar p50: 1.77 / 1.78 / 1.87), so one table serves all.
 *
 * Out of sample (calibrate on the first 60% of each series, score the last 40%) the p50 / p80 / p90 forecasts held
 * 47-53% / 77-86% / 88-93% of the time across 9 timeframe x horizon combinations. The upper tails ran slightly short
 * on 15m and 1h (about 88% for the p90), so treat p90 as "roughly 1 in 8 exceed", not a guarantee.
 *
 * Per-regime multipliers were tried and NOT adopted: the gain was small (about 0.5% pinball loss at 4 bars, up to 5% at
 * 24 bars on 15m/1h) and reversed on 4h. Only the direction of the regime effect was consistent, so it is a hint (below).
 */
export const RISK_HORIZONS = [4, 12, 24] as const;
export type RiskHorizon = (typeof RISK_HORIZONS)[number];
export interface RangeMultiples {
  p50: number;
  p80: number;
  p90: number;
}
export const RISK_TABLE: Record<RiskHorizon, RangeMultiples> = {
  4: { p50: 1.81, p80: 2.75, p90: 3.53 },
  12: { p50: 3.29, p80: 4.99, p90: 6.38 },
  24: { p50: 4.79, p80: 7.26, p90: 9.28 },
};

export interface RangeForecast {
  h: RiskHorizon;
  p50: number;
  p80: number;
  p90: number;
} // percent of price

/** Expected range for each horizon, in percent of price, from the current ATR% (as a percent, e.g. 0.24). */
export function forecastRanges(atrPct: number): RangeForecast[] {
  return RISK_HORIZONS.map((h) => ({
    h,
    p50: atrPct * RISK_TABLE[h].p50,
    p80: atrPct * RISK_TABLE[h].p80,
    p90: atrPct * RISK_TABLE[h].p90,
  }));
}

/** Wall-clock length of h bars, e.g. "3h" or "2d". */
export function windowLabel(h: number, tfSeconds: number): string {
  const sec = h * tfSeconds;
  if (sec >= 86400) {
    const d = sec / 86400;
    return `${Number.isInteger(d) ? d : d.toFixed(1)}d`;
  }
  if (sec >= 3600) {
    const x = sec / 3600;
    return `${Number.isInteger(x) ? x : x.toFixed(1)}h`;
  }
  return `${Math.round(sec / 60)}m`;
}

/**
 * Backtests showed the direction of this effect on all three timeframes at 24 bars: after low volatility, range tends to expand
 * beyond what current ATR implies; after high volatility it tends to contract. The size was not reliable enough to adjust the numbers.
 */
export function regimeHint(vol: VolRegime): string | null {
  if (vol === "SQUEEZE" || vol === "LOW")
    return "Volatility is currently low. Over longer windows it has tended to expand beyond what the current ATR implies, so the wider figures are the safer guide.";
  if (vol === "HIGH" || vol === "EXTREME")
    return "Volatility is currently high. Over longer windows it has tended to settle back below what the current ATR implies, so the wider figures may overstate.";
  return null;
}
