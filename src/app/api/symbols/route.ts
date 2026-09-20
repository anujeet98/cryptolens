import { NextResponse } from "next/server";
import { connectors } from "@/exchanges";
import { fail } from "@/lib/api";
import type { CoinListing } from "@/types/market";
import { withAuth } from "@/lib/auth/guard";

export const maxDuration = 30;

async function handle() {
  try {
    const results = await Promise.allSettled(Object.values(connectors).map((c) => c!.listMarkets()));
    const merged = new Map<string, CoinListing>();
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const l of r.value) {
        const cur = merged.get(l.base) ?? { base: l.base, markets: [] };
        cur.markets.push(...l.markets);
        merged.set(l.base, cur);
      }
    }
    if (!merged.size) throw new Error("no exchange available");
    return NextResponse.json([...merged.values()], { headers: { "Cache-Control": "public, max-age=600" } });
  } catch (e) {
    return fail(e);
  }
}

export const GET = withAuth(handle);
