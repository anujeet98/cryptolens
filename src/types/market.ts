export type ExchangeId = "binance" | "bybit" | "okx";
export type MarketType = "spot" | "perp";

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export interface Candle {
  time: number; // unix seconds, candle open
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // base volume
  quoteVolume: number;
  closed: boolean;
}

export interface Ticker24h {
  exchange: ExchangeId;
  symbol: string;
  marketType: MarketType;
  timestamp: number;
  price: number;
  changePct: number;
  high: number;
  low: number;
  quoteVolume: number;
}

export interface MarketRef {
  exchange: ExchangeId;
  marketType: MarketType;
  quote: string; // USDT, USDC ...
  symbol: string; // exchange-native symbol
}

export interface CoinListing {
  base: string;
  markets: MarketRef[];
}
