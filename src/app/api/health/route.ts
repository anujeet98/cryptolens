import { NextResponse } from "next/server";
import { authStatus } from "@/lib/auth/providers";
import { PROBES, runProbe, summarize } from "@/lib/health";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Deployment health: can this server reach the exchanges from where it runs? Used by the deploy pipeline as a gate
 * (a region that is geo-blocked by Binance must never go live) and handy for checking production by hand.
 * Returns 200 when every core probe passes, 503 otherwise. Contains no secrets.
 */
export async function GET() {
  const results = await Promise.all(PROBES.map((p) => runProbe(p)));
  const s = summarize(results);
  const auth = authStatus(process.env); // enabled + which providers; never any secret
  return NextResponse.json(
    {
      ok: s.ok,
      failedCore: s.failedCore,
      degraded: s.degraded,
      region: process.env.VERCEL_REGION ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      checkedAt: new Date().toISOString(),
      auth: { enabled: auth.enabled, providers: auth.providers, ...(auth.enabled ? {} : { reason: auth.reason }) },
      exchanges: results,
    },
    { status: s.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
