import { NextRequest, NextResponse } from "next/server";
import { getConnector } from "@/exchanges";
import { fail, SYMBOL_RE } from "@/lib/api";
import type { ExchangeId, MarketType } from "@/types/market";

/** Fresh REST order-book snapshot (never cached: it anchors the local book's sequence numbers). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const exchange = (p.get("exchange") ?? "binance") as ExchangeId;
  const symbol = (p.get("symbol") ?? "").toUpperCase();
  const market = p.get("market") as MarketType;
  if (!SYMBOL_RE.test(symbol) || !["spot", "perp"].includes(market)) return fail("invalid params", 400);
  try {
    const c = getConnector(exchange);
    if (!c.getOrderBookSnapshot) return fail("order book not supported", 404);
    return NextResponse.json(await c.getOrderBookSnapshot(symbol, market, 1000), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
