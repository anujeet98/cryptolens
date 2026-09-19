import type { FundingClass } from "@/analysis/funding";
import type { LiqSnapshot } from "@/liquidations/liqs";
import type { Regime } from "@/regime/regime";
import type { Candle, MarketType, Timeframe } from "@/types/market";
import { trailingRangePct, type Snapshot } from "./engine";

/** The identity of what is on screen. Data from any source is only trusted if it was produced for this exact context. */
export const contextKey = (symbol: string, market: MarketType, tf: Timeframe) => `${symbol}:${market}:${tf}`;

export interface SnapshotInput {
  symbol: string;
  market: MarketType;
  tf: Timeframe;
  ts: number;
  perpSymbol: string | null;
  liveKey: string; // context the candles/ticker were loaded for
  candles: Candle[];
  regime: Regime | null;
  liq: LiqSnapshot | null;
  fundingClass: FundingClass | null; // already keyed to the perp symbol by its own hook
}

/**
 * Build the alert snapshot, refusing anything that does not belong to the current context.
 * After switching coin or timeframe, the market hook briefly still holds the PREVIOUS coin's candles. Priming the alert
 * engine on those would make the new coin's real state look like a fresh transition, i.e. a false alarm. So:
 *   - candles/regime from a different context  -> no snapshot at all (the engine waits)
 *   - liquidation data computed for another symbol -> that one signal has no opinion
 */
export function buildSnapshot(i: SnapshotInput): Snapshot | null {
  if (i.liveKey !== contextKey(i.symbol, i.market, i.tf)) return null;
  if (!i.regime) return null;
  const liqOk = i.perpSymbol !== null && i.liq !== null && i.liq.symbol === i.perpSymbol;
  return {
    symbol: i.symbol,
    tf: i.tf,
    ts: i.ts,
    volatility: i.regime.volatility,
    atrPct: i.regime.atrPct,
    trailingRangePct: trailingRangePct(i.candles),
    liqBurst: liqOk ? i.liq!.burst : null,
    fundingClass: i.fundingClass,
  };
}
