import { NextRequest, NextResponse } from "next/server";
import { getConnector } from "@/exchanges";
import { fail, SYMBOL_RE } from "@/lib/api";
import type { ExchangeId, MarketType } from "@/types/market";

export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const exchange = (p.get("exchange") ?? "binance") as ExchangeId;
  const symbol = (p.get("symbol") ?? "").toUpperCase();
  const marketType = p.get("market") as MarketType;
  if (!SYMBOL_RE.test(symbol) || !["spot", "perp"].includes(marketType)) return fail("invalid params", 400);
  try {
    return NextResponse.json(await getConnector(exchange).getTicker24h(symbol, marketType));
  } catch (e) {
    return fail(e);
  }
}
