import { NextRequest, NextResponse } from "next/server";
import { connectors } from "@/exchanges";
import { fundingIntervalHours } from "@/analysis/funding";
import { cached } from "@/lib/cache";
import { fail } from "@/lib/api";
import type { ExchangeRow } from "@/crossexchange/compare";
import type { ExchangeId } from "@/types/market";

export const maxDuration = 20;

const BASE_RE = /^[A-Z0-9]{1,15}$/;

/** Perp data for one coin from every connector that lists it. One venue failing never blanks the others. */
export async function GET(req: NextRequest) {
  const base = (req.nextUrl.searchParams.get("base") ?? "").toUpperCase();
  if (!BASE_RE.test(base)) return fail("invalid params", 400);
  try {
    const data = await cached(`xchange:${base}`, 4_000, async () => {
      const rows: ExchangeRow[] = [];
      const errors: { exchange: ExchangeId; message: string }[] = [];
      await Promise.all(Object.values(connectors).map(async (c) => {
        if (!c || !c.derivatives) return;
        try {
          const listing = (await c.listMarkets()).find((l) => l.base === base);
          const perps = listing?.markets.filter((m) => m.marketType === "perp") ?? [];
          const m = perps.find((x) => x.quote === "USDT") ?? perps[0];
          if (!m) return; // not listed on this venue
          const d = c.derivatives;
          const [snap, tick, fund] = await Promise.all([
            d.getSnapshot(m.symbol),
            c.getTicker24h(m.symbol, "perp"),
            d.getFundingHistory(m.symbol, 6),
          ]);
          rows.push({
            exchange: c.id, symbol: m.symbol, price: tick.price, mark: snap.markPrice, index: snap.indexPrice,
            fundingRate: snap.fundingRate, fundingIntervalHours: fundingIntervalHours(fund), nextFundingTime: snap.nextFundingTime,
            oiUsd: snap.openInterestUsd, volume24hUsd: tick.quoteVolume, changePct24h: tick.changePct,
          });
        } catch (e) {
          errors.push({ exchange: c.id, message: e instanceof Error ? e.message : "failed" });
        }
      }));
      rows.sort((a, b) => a.exchange.localeCompare(b.exchange));
      return { rows, errors };
    });
    return NextResponse.json(data);
  } catch (e) {
    return fail(e);
  }
}
