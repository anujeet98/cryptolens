import { describe, expect, it } from "vitest";
import { PROBES, runProbe, summarize, type ProbeResult } from "./health";

const r = (id: string, core: boolean, ok: boolean): ProbeResult => ({ id, label: id, core, ok, status: ok ? 200 : 451, ms: 10 });

describe("summarize", () => {
  it("is healthy when every core probe passes, even if optional exchanges are down", () => {
    const s = summarize([r("a", true, true), r("b", true, true), r("c", false, false)]);
    expect(s.ok).toBe(true);
    expect(s.degraded).toEqual(["c"]);
    expect(s.failedCore).toEqual([]);
  });
  it("is unhealthy when any core probe fails", () => {
    const s = summarize([r("a", true, true), r("b", true, false), r("c", false, true)]);
    expect(s.ok).toBe(false);
    expect(s.failedCore).toEqual(["b"]);
  });
  it("never reports healthy with no core probes at all", () => {
    expect(summarize([]).ok).toBe(false);
    expect(summarize([r("c", false, true)]).ok).toBe(false);
  });
});

describe("runProbe", () => {
  const probe = { id: "x", label: "X", url: "https://example.test/ping", core: true };
  const res = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response;

  it("reports success with status and latency", async () => {
    const out = await runProbe(probe, async () => res(200));
    expect(out).toMatchObject({ id: "x", ok: true, status: 200, core: true });
    expect(out.ms).not.toBeNull();
    expect(out.error).toBeUndefined();
  });
  it("names an HTTP 451 as a region block, because that is the failure a bad deployment region causes", async () => {
    const out = await runProbe(probe, async () => res(451));
    expect(out.ok).toBe(false);
    expect(out.error).toContain("region");
  });
  it("turns a network error or timeout into a failed result instead of throwing", async () => {
    const out = await runProbe(probe, async () => { throw new Error("getaddrinfo ENOTFOUND"); });
    expect(out.ok).toBe(false);
    expect(out.status).toBeNull();
    expect(out.error).toContain("ENOTFOUND");
  });
});

describe("PROBES", () => {
  it("marks exactly the Binance endpoints as core (the app's charts and flow depend on them)", () => {
    expect(PROBES.filter((p) => p.core).map((p) => p.id).sort()).toEqual(["binance-perp", "binance-spot"]);
    expect(new Set(PROBES.map((p) => p.id)).size).toBe(PROBES.length);
    for (const p of PROBES) expect(p.url.startsWith("https://")).toBe(true);
  });
});
