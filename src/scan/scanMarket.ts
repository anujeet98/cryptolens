/**
 * Multi-symbol scan: ranks liquid Binance USDT perps by how much they're worth looking at right now.
 *
 * Ranking is deliberately volatility-first. The backtests in src/backtest found that the trend/momentum
 * labels carry no significant directional edge, but the volatility label does predict range size. So
 * "top pick" here means "unusually large expected move, direction shown but not implied" — not a signal
 * that this coin will go up or down. Callers (including LLM agents) must not present these as trade calls.
 */
import { binance } from "@/exchanges/binance";
import { classifyRegime, type Regime } from "@/regime/regime";
import type { Candle, Timeframe } from "@/types/market";

export interface ScanResult {
  symbol: string;
  price: number;
  changePct24h: number;
  quoteVolume24h: number;
  regime: Regime;
}

interface BinanceTicker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

async function bulkTickers(): Promise<BinanceTicker24h[]> {
  const res = await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr", {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Binance ticker/24hr ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

export interface ScanOptions {
  timeframe?: Timeframe;
  /** How many of the most liquid perps to actually pull candles for and classify. */
  candidatePool?: number;
  /** How many results to return, after ranking. */
  limit?: number;
  concurrency?: number;
}

/** Fetches candles + classifies regime for one symbol. Returns null if there isn't enough history yet. */
export async function scanSymbol(symbol: string, timeframe: Timeframe = "15m"): Promise<Regime | null> {
  const candles: Candle[] = await binance.getCandles(symbol, "perp", timeframe, 150);
  return classifyRegime(candles, timeframe);
}

/**
 * Scans the most liquid Binance USDT perps, ranked by ATR percentile (the one label with backtested
 * predictive value) then by |trendScore| * confidence as a tiebreak for directional conviction.
 */
export async function scanMarket(opts: ScanOptions = {}): Promise<ScanResult[]> {
  const { timeframe = "15m", candidatePool = 80, limit = 25, concurrency = 8 } = opts;

  const tickers = await bulkTickers();
  const usdtPerps = tickers
    .filter((t) => t.symbol.endsWith("USDT") && !t.symbol.includes("_")) // "_" excludes quarterly/delivery contracts
    .sort((a, b) => +b.quoteVolume - +a.quoteVolume)
    .slice(0, candidatePool);

  const results = await mapWithConcurrency(usdtPerps, concurrency, async (t): Promise<ScanResult | null> => {
    try {
      const regime = await scanSymbol(t.symbol, timeframe);
      if (!regime) return null;
      return {
        symbol: t.symbol,
        price: +t.lastPrice,
        changePct24h: +t.priceChangePercent,
        quoteVolume24h: +t.quoteVolume,
        regime,
      };
    } catch {
      return null; // one symbol's failure (delisted, bad data) never kills the scan
    }
  });

  return results
    .filter((r): r is ScanResult => r !== null)
    .sort((a, b) => {
      const volDiff = b.regime.atrPercentile - a.regime.atrPercentile;
      if (Math.abs(volDiff) > 1) return volDiff;
      const convA = Math.abs(a.regime.trendScore) * (a.regime.confidence / 100);
      const convB = Math.abs(b.regime.trendScore) * (b.regime.confidence / 100);
      return convB - convA;
    })
    .slice(0, limit);
}
