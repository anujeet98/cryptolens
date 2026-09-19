/** One upstream reachability probe. */
export interface Probe { id: string; label: string; url: string; core: boolean }
export interface ProbeResult { id: string; label: string; core: boolean; ok: boolean; status: number | null; ms: number | null; error?: string }

/**
 * Cheap, key-free endpoints that answer "can this server reach that exchange from here?".
 * Exchanges geo-block by IP (Binance refuses US datacenters with HTTP 451), so a deployment region has to be verified, not assumed.
 * `core` probes are the ones the app cannot work without; the rest degrade one panel.
 */
export const PROBES: Probe[] = [
  { id: "binance-perp", label: "Binance perp", url: "https://fapi.binance.com/fapi/v1/ping", core: true },
  { id: "binance-spot", label: "Binance spot", url: "https://api.binance.com/api/v3/ping", core: true },
  { id: "bybit", label: "Bybit", url: "https://api.bybit.com/v5/market/time", core: false },
  { id: "bitget", label: "Bitget", url: "https://api.bitget.com/api/v2/public/time", core: false },
];

export interface HealthSummary {
  ok: boolean; // every core probe reachable
  degraded: string[]; // non-core probes that failed
  failedCore: string[];
}

export function summarize(results: ProbeResult[]): HealthSummary {
  const failedCore = results.filter((r) => r.core && !r.ok).map((r) => r.id);
  const degraded = results.filter((r) => !r.core && !r.ok).map((r) => r.id);
  return { ok: failedCore.length === 0 && results.some((r) => r.core), failedCore, degraded };
}

/** Probe one endpoint. Never throws: a failure is a result, not an exception. */
export async function runProbe(p: Probe, fetchFn: typeof fetch = fetch, timeoutMs = 6000): Promise<ProbeResult> {
  const t0 = Date.now();
  const base = { id: p.id, label: p.label, core: p.core };
  try {
    const res = await fetchFn(p.url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return { ...base, ok: res.ok, status: res.status, ms: Date.now() - t0, ...(res.ok ? {} : { error: res.status === 451 ? "blocked for this region (HTTP 451)" : `HTTP ${res.status}` }) };
  } catch (e) {
    return { ...base, ok: false, status: null, ms: Date.now() - t0, error: e instanceof Error ? e.message : "unreachable" };
  }
}
