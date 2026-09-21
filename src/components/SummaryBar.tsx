import type { ConnState } from "@/hooks/useLiveMarket";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import type { Ticker24h } from "@/types/market";

function Stat({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span className={`num text-sm ${cls}`}>{value}</span>
    </div>
  );
}

export interface DerivStats {
  funding?: number;
  oiUsd?: number;
  oiChg1h?: number | null;
  ls?: number;
}

export function SummaryBar({
  t,
  state,
  age,
  d,
}: {
  t: Ticker24h | null;
  state: ConnState;
  age: number;
  d?: DerivStats;
}) {
  const stale = state === "live" && age > 10_000;
  const badge =
    state === "live" && !stale
      ? { txt: "LIVE", cls: "text-bull" }
      : stale
        ? { txt: `STALE ${Math.round(age / 1000)}s`, cls: "text-warn" }
        : state === "reconnecting"
          ? { txt: "RECONNECTING", cls: "text-warn" }
          : state === "error"
            ? { txt: "ERROR", cls: "text-bear" }
            : { txt: "LOADING", cls: "text-muted" };
  const up = (t?.changePct ?? 0) >= 0;
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
      <div>
        <div className={`num text-3xl font-semibold ${up ? "text-bull" : "text-bear"}`}>
          {t ? `$${fmtPrice(t.price)}` : "—"}
        </div>
        <div className={`num text-sm ${up ? "text-bull" : "text-bear"}`}>
          {t ? fmtPct(t.changePct) : ""} <span className="text-muted">24h</span>
        </div>
      </div>
      <Stat label="24h High" value={t ? fmtPrice(t.high) : "—"} />
      <Stat label="24h Low" value={t ? fmtPrice(t.low) : "—"} />
      <Stat label="24h Volume" value={t ? fmtUsd(t.quoteVolume) : "—"} />
      {d?.funding !== undefined && (
        <Stat
          label="Funding"
          value={`${d.funding >= 0 ? "+" : ""}${(d.funding * 100).toFixed(4)}%`}
          cls={d.funding > 0 ? "text-bull" : d.funding < 0 ? "text-bear" : ""}
        />
      )}
      {d?.oiUsd !== undefined && <Stat label="Open interest" value={fmtUsd(d.oiUsd)} />}
      {d?.oiChg1h != null && (
        <Stat
          label="OI Δ 1h"
          value={fmtPct(d.oiChg1h)}
          cls={d.oiChg1h > 0 ? "text-bull" : d.oiChg1h < 0 ? "text-bear" : ""}
        />
      )}
      {d?.ls !== undefined && <Stat label="Long/Short" value={d.ls.toFixed(2)} />}
      <div className="ml-auto flex items-center gap-2 text-xs">
        <span className={`h-2 w-2 rounded-full bg-current ${badge.cls}`} />
        <span className={`font-medium ${badge.cls}`}>{badge.txt}</span>
      </div>
    </div>
  );
}
