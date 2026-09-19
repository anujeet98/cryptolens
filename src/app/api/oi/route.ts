import { NextRequest, NextResponse } from "next/server";
import { getConnector } from "@/exchanges";
import { cached } from "@/lib/cache";
import { fail, SYMBOL_RE } from "@/lib/api";
import type { ExchangeId, OiPeriod } from "@/types/market";

export const maxDuration = 15;

const PERIODS = ["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"];

/** Open-interest history at a given period, used to plot OI under the price chart. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const exchange = (p.get("exchange") ?? "binance") as ExchangeId;
  const symbol = (p.get("symbol") ?? "").toUpperCase();
  const period = p.get("period") as OiPeriod;
  if (!SYMBOL_RE.test(symbol) || !PERIODS.includes(period)) return fail("invalid params", 400);
  try {
    const d = getConnector(exchange).derivatives;
    if (!d) return fail("derivatives not supported", 404);
    return NextResponse.json(await cached(`oi:${exchange}:${symbol}:${period}`, 15_000, () => d.getOpenInterestHistory(symbol, period, 500)));
  } catch (e) {
    return fail(e);
  }
}
