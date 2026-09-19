import type { Candle, CoinListing, DerivativesSnapshot, ExchangeId, FundingPoint, LongShortPoint, MarketType, OiPeriod, OiPoint, Ticker24h, Timeframe } from "@/types/market";

/** Every exchange implements this; the API layer never talks to an exchange directly. */
export interface ExchangeConnector {
  id: ExchangeId;
  listMarkets(): Promise<CoinListing[]>;
  getCandles(symbol: string, marketType: MarketType, tf: Timeframe, limit: number): Promise<Candle[]>;
  getTicker24h(symbol: string, marketType: MarketType): Promise<Ticker24h>;
  getOrderBookSnapshot?(symbol: string, marketType: MarketType, limit: number): Promise<{ lastUpdateId: number; bids: [number, number][]; asks: [number, number][] }>;
  /** Perp-only data; connectors without it simply leave these undefined. */
  derivatives?: {
    getSnapshot(symbol: string): Promise<DerivativesSnapshot>;
    getFundingHistory(symbol: string, limit: number): Promise<FundingPoint[]>;
    getOpenInterestHistory(symbol: string, period: OiPeriod, limit: number): Promise<OiPoint[]>;
    getLongShortRatio(symbol: string, period: OiPeriod, limit: number): Promise<LongShortPoint[]>;
  };
}
