import type { Candle } from "@/types/market";

export interface SimOptions {
  feeBps: number; // per side, on the traded notional
  slipBps: number; // per side
  barsPerYear: number;
}

export interface SimResult {
  equity: number[]; // starts at 1, one entry per bar from `start`
  totalReturn: number;
  buyHoldReturn: number;
  maxDrawdown: number; // negative fraction
  trades: number; // position entries (flat->pos, or a flip counts once)
  exposure: number; // share of bars holding a position
  sharpe: number | null; // annualised from bar returns; null if undefined
  costPaid: number; // sum of fee+slippage as a fraction of starting equity terms (log-additive approx)
  bars: number;
}

/**
 * desired[i] in {-1, 0, +1} is the position DECIDED at the close of bar i and EXECUTED at the open of bar i+1.
 * A held position is marked close-to-close; a change exits the old position at the new bar's open, enters the new one at that open,
 * and pays (fee + slippage) on every unit of position traded. Unlevered, no funding, no compounding of costs beyond the equity curve.
 */
export function simulate(candles: Candle[], desired: number[], start: number, opts: SimOptions): SimResult {
  const cost = (opts.feeBps + opts.slipBps) / 10_000;
  const equity: number[] = [1];
  const rets: number[] = [];
  let held = 0, trades = 0, exposed = 0, costPaid = 0;
  for (let j = start + 1; j < candles.length; j++) {
    const next = desired[j - 1] ?? 0;
    const prevClose = candles[j - 1].close, o = candles[j].open, c = candles[j].close;
    let r: number;
    if (next !== held) {
      r = held * (o / prevClose - 1) + next * (c / o - 1);
      const traded = Math.abs(next - held);
      r -= traded * cost;
      costPaid += traded * cost;
      if (next !== 0) trades++;
      held = next;
    } else {
      r = held * (c / prevClose - 1);
    }
    if (held !== 0) exposed++;
    rets.push(r);
    equity.push(equity[equity.length - 1] * (1 + r));
  }
  let peak = 1, dd = 0;
  for (const e of equity) { peak = Math.max(peak, e); dd = Math.min(dd, e / peak - 1); }
  const m = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1)) : 0;
  return {
    equity, totalReturn: equity[equity.length - 1] - 1,
    buyHoldReturn: candles.length > start + 1 ? candles[candles.length - 1].close / candles[start].close - 1 : 0,
    maxDrawdown: dd, trades, exposure: rets.length ? exposed / rets.length : 0,
    sharpe: sd > 0 ? (m / sd) * Math.sqrt(opts.barsPerYear) : null, costPaid, bars: rets.length,
  };
}
