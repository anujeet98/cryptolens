import type { Candle, CoinListing, ExchangeId, MarketType, Ticker24h, Timeframe } from "@/types/market";

/** Every exchange implements this; the API layer never talks to an exchange directly. */
export interface ExchangeConnector {
  id: ExchangeId;
  listMarkets(): Promise<CoinListing[]>;
  getCandles(symbol: string, marketType: MarketType, tf: Timeframe, limit: number): Promise<Candle[]>;
  getTicker24h(symbol: string, marketType: MarketType): Promise<Ticker24h>;
}
