import type { ExchangeConnector } from "../types";
import type { Candle, CoinListing, DerivativesSnapshot, FundingPoint, LongShortPoint, MarketRef, MarketType, OiPeriod, OiPoint, Ticker24h, Timeframe } from "@/types/market";

const REST = "https://api.bybit.com/v5/market";
const CATEGORY = { spot: "spot", perp: "linear" } as const;

/** Bybit kline interval codes. */
const INTERVAL: Record<Timeframe, string> = { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "D" };
const TF_SEC: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400 };
/** Bybit open-interest / account-ratio only support these periods (no 2h/6h/12h). */
const OI_INTERVAL: Partial<Record<OiPeriod, string>> = { "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "4h": "4h", "1d": "1d" };

interface Envelope<T> { retCode: number; retMsg: string; result: T }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${REST}/${path}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Bybit ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as Envelope<T>;
  if (j.retCode !== 0) throw new Error(`Bybit ${j.retCode}: ${j.retMsg}`);
  return j.result;
}

interface Instrument { symbol: string; baseCoin: string; quoteCoin: string; status: string; contractType?: string }
interface InstrumentList { list: Instrument[]; nextPageCursor?: string }

/** Instruments are paginated; follow the cursor (bounded) until exhausted. */
async function listInstruments(category: "spot" | "linear"): Promise<Instrument[]> {
  const out: Instrument[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const r = await get<InstrumentList>(`instruments-info?category=${category}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...r.list);
    if (!r.nextPageCursor) break;
    cursor = r.nextPageCursor;
  }
  return out;
}

let listCache: { at: number; data: CoinListing[] } | null = null;

export const bybit: ExchangeConnector = {
  id: "bybit",

  async listMarkets() {
    if (listCache && Date.now() - listCache.at < 3_600_000) return listCache.data;
    const [spot, perp] = await Promise.all([listInstruments("spot"), listInstruments("linear")]);
    const map = new Map<string, MarketRef[]>();
    const add = (base: string, m: MarketRef) => { const a = map.get(base) ?? []; a.push(m); map.set(base, a); };
    for (const s of spot)
      if (s.status === "Trading" && ["USDT", "USDC"].includes(s.quoteCoin))
        add(s.baseCoin, { exchange: "bybit", marketType: "spot", quote: s.quoteCoin, symbol: s.symbol });
    for (const s of perp)
      if (s.status === "Trading" && s.contractType === "LinearPerpetual" && ["USDT", "USDC"].includes(s.quoteCoin))
        add(s.baseCoin, { exchange: "bybit", marketType: "perp", quote: s.quoteCoin, symbol: s.symbol });
    const data = [...map].map(([base, markets]) => ({ base, markets }));
    listCache = { at: Date.now(), data };
    return data;
  },

  async getCandles(symbol, marketType, tf: Timeframe, limit) {
    const r = await get<{ list: string[][] }>(`kline?category=${CATEGORY[marketType]}&symbol=${symbol}&interval=${INTERVAL[tf]}&limit=${Math.min(limit, 1000)}`);
    const now = Date.now();
    // Newest-first arrays: [startMs, open, high, low, close, volume, turnover]; the API has no close time, so derive it.
    return r.list.map((k): Candle => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: +k[1], high: +k[2], low: +k[3], close: +k[4],
      volume: +k[5], quoteVolume: +k[6],
      closed: Number(k[0]) + TF_SEC[tf] * 1000 <= now,
    })).reverse();
  },

  async getTicker24h(symbol, marketType: MarketType): Promise<Ticker24h> {
    const r = await get<{ list: Record<string, string>[] }>(`tickers?category=${CATEGORY[marketType]}&symbol=${symbol}`);
    const t = r.list[0];
    if (!t) throw new Error(`Bybit: no ticker for ${symbol}`);
    return {
      exchange: "bybit", symbol, marketType, timestamp: Date.now(),
      price: +t.lastPrice, changePct: +t.price24hPcnt * 100,
      high: +t.highPrice24h, low: +t.lowPrice24h, quoteVolume: +t.turnover24h,
    };
  },

  derivatives: {
    async getSnapshot(symbol): Promise<DerivativesSnapshot> {
      const r = await get<{ list: Record<string, string>[] }>(`tickers?category=linear&symbol=${symbol}`);
      const t = r.list[0];
      if (!t) throw new Error(`Bybit: no ticker for ${symbol}`);
      const mark = +t.markPrice;
      return {
        exchange: "bybit", symbol, timestamp: Date.now(),
        markPrice: mark, indexPrice: +t.indexPrice, fundingRate: +t.fundingRate,
        nextFundingTime: Number(t.nextFundingTime),
        openInterest: +t.openInterest, openInterestUsd: +t.openInterest * mark,
      };
    },
    async getFundingHistory(symbol, limit): Promise<FundingPoint[]> {
      const r = await get<{ list: { fundingRate: string; fundingRateTimestamp: string }[] }>(`funding/history?category=linear&symbol=${symbol}&limit=${Math.min(limit, 200)}`);
      return r.list.map((x) => ({ time: Math.floor(Number(x.fundingRateTimestamp) / 1000), rate: +x.fundingRate })).reverse(); // oldest first
    },
    async getOpenInterestHistory(symbol, period: OiPeriod, limit): Promise<OiPoint[]> {
      const iv = OI_INTERVAL[period];
      if (!iv) throw new Error(`Bybit does not offer ${period} open-interest history`);
      const [r, t] = await Promise.all([
        get<{ list: { openInterest: string; timestamp: string }[] }>(`open-interest?category=linear&symbol=${symbol}&intervalTime=${iv}&limit=${Math.min(limit, 200)}`),
        get<{ list: Record<string, string>[] }>(`tickers?category=linear&symbol=${symbol}`),
      ]);
      // History carries contracts only. Notional is valued at the current mark, so older points are approximate.
      const mark = +(t.list[0]?.markPrice ?? 0);
      return r.list.map((x) => ({ time: Math.floor(Number(x.timestamp) / 1000), oi: +x.openInterest, oiUsd: +x.openInterest * mark })).reverse();
    },
    async getLongShortRatio(symbol, period: OiPeriod, limit): Promise<LongShortPoint[]> {
      const iv = OI_INTERVAL[period];
      if (!iv) throw new Error(`Bybit does not offer ${period} long/short history`);
      const r = await get<{ list: { buyRatio: string; sellRatio: string; timestamp: string }[] }>(`account-ratio?category=linear&symbol=${symbol}&period=${iv}&limit=${Math.min(limit, 500)}`);
      return r.list.map((x) => ({ time: Math.floor(Number(x.timestamp) / 1000), ratio: +x.buyRatio / +x.sellRatio, longPct: +x.buyRatio * 100, shortPct: +x.sellRatio * 100 })).reverse();
    },
  },
};
