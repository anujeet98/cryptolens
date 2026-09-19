import { NextRequest, NextResponse } from "next/server";
import { getConnector } from "@/exchanges";
import { cached } from "@/lib/cache";
import { fail, SYMBOL_RE } from "@/lib/api";
import type { ExchangeId } from "@/types/market";

export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const exchange = (p.get("exchange") ?? "binance") as ExchangeId;
  const symbol = (p.get("symbol") ?? "").toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return fail("invalid params", 400);
  try {
    const d = getConnector(exchange).derivatives;
    if (!d) return fail("derivatives not supported", 404);
    const data = await cached(`deriv:${exchange}:${symbol}`, 4_000, async () => {
      const [snapshot, funding, oi5m, ls] = await Promise.all([
        d.getSnapshot(symbol),
        cached(`fund:${exchange}:${symbol}`, 60_000, () => d.getFundingHistory(symbol, 400)),
        cached(`oi5:${exchange}:${symbol}`, 15_000, () => d.getOpenInterestHistory(symbol, "5m", 500)),
        cached(`ls:${exchange}:${symbol}`, 15_000, () => d.getLongShortRatio(symbol, "5m", 60)).catch(() => []),
      ]);
      return { snapshot, funding, oi5m, ls };
    });
    return NextResponse.json(data);
  } catch (e) {
    return fail(e);
  }
}
