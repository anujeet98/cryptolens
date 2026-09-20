import { NextRequest, NextResponse } from "next/server";
import { getConnector } from "@/exchanges";
import { fail, SYMBOL_RE } from "@/lib/api";
import { TIMEFRAMES, type ExchangeId, type MarketType, type Timeframe } from "@/types/market";

export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const exchange = (p.get("exchange") ?? "binance") as ExchangeId;
  const symbol = (p.get("symbol") ?? "").toUpperCase();
  const marketType = p.get("market") as MarketType;
  const tf = p.get("tf") as Timeframe;
  const limit = Math.min(Number(p.get("limit") ?? 500), 1000);
  if (!SYMBOL_RE.test(symbol) || !["spot", "perp"].includes(marketType) || !TIMEFRAMES.includes(tf))
    return fail("invalid params", 400);
  try {
    return NextResponse.json(await getConnector(exchange).getCandles(symbol, marketType, tf, limit));
  } catch (e) {
    return fail(e);
  }
}
