import { useMemo } from "react";
import { compareExchanges } from "@/crossexchange/compare";
import type { CrossExchangeState } from "@/hooks/useCrossExchange";
import { fmtPrice, fmtUsd } from "@/lib/format";

const tone = (v: number) => (v > 0 ? "text-bull" : v < 0 ? "text-bear" : "text-muted");
const sgn = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
const Th = ({ children, left }: { children?: React.ReactNode; left?: boolean }) => (
  <th className={`px-2 py-1 font-normal ${left ? "text-left" : "text-right"}`}>{children}</th>
);

export function CrossExchangePanel({ x, now }: { x: CrossExchangeState; now: number }) {
  const cmp = useMemo(() => compareExchanges(x.rows), [x.rows]);
  const age = x.updatedAt ? Math.round((now - x.updatedAt) / 1000) : null;

  if (!cmp) {
    return (
      <section className="rounded border border-line bg-panel p-4 text-sm text-muted">
        Cross-exchange:{" "}
        {x.loading ? "loading venues…" : (x.error ?? `no perpetual market found for ${x.base} on any connected venue.`)}
      </section>
    );
  }

  return (
    <section className="rounded border border-line bg-panel">
      <div className="flex items-baseline justify-between border-b border-line px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Cross-exchange · {x.base} perp
        </span>
        <span className="num text-[11px] text-muted">
          funding spread {cmp.fundingSpread8hBps.toFixed(1)} bps/8h · mark spread {cmp.markSpreadBps.toFixed(1)} bps
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase text-muted">
              <Th left>Venue</Th>
              <Th>Mark</Th>
              <Th>vs {cmp.ref}</Th>
              <Th>Prem.</Th>
              <Th>Funding /8h</Th>
              <Th>APR</Th>
              <Th>OI</Th>
              <Th>OI share</Th>
              <Th>24h vol</Th>
              <Th>Vol share</Th>
              <Th>24h</Th>
            </tr>
          </thead>
          <tbody>
            {cmp.rows.map((r) => (
              <tr
                key={r.exchange}
                className={`border-t border-line ${r.suspect ? "text-muted" : ""}`}
                title={
                  r.suspect
                    ? "Contract size likely differs: excluded from totals"
                    : `${r.symbol} · funding every ${r.fundingIntervalHours}h`
                }
              >
                <td className="px-2 py-1 font-medium">
                  {r.exchange}
                  {r.exchange === cmp.ref ? " (ref)" : ""}
                </td>
                <td className="num px-2 text-right">{fmtPrice(r.mark)}</td>
                <td className={`num px-2 text-right ${r.suspect ? "" : tone(r.markVsRefBps)}`}>
                  {r.exchange === cmp.ref ? "—" : `${sgn(r.markVsRefBps, 1)} bps`}
                </td>
                <td className={`num px-2 text-right ${tone(r.premiumBps)}`}>{sgn(r.premiumBps, 1)} bps</td>
                <td className={`num px-2 text-right ${tone(r.funding8h)}`}>
                  {sgn(r.funding8h * 100, 4)}%{r.fundingIntervalHours !== 8 ? ` (${r.fundingIntervalHours}h)` : ""}
                </td>
                <td className={`num px-2 text-right ${tone(r.fundingApr)}`}>{sgn(r.fundingApr * 100, 1)}%</td>
                <td className="num px-2 text-right">{fmtUsd(r.oiUsd)}</td>
                <td className="num px-2 text-right">{r.suspect ? "n/a" : `${r.oiSharePct.toFixed(0)}%`}</td>
                <td className="num px-2 text-right">{fmtUsd(r.volume24hUsd)}</td>
                <td className="num px-2 text-right">{r.suspect ? "n/a" : `${r.volumeSharePct.toFixed(0)}%`}</td>
                <td className={`num px-2 text-right ${tone(r.changePct24h)}`}>{sgn(r.changePct24h)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cmp.notes.length > 0 && (
        <ul className="space-y-0.5 border-t border-line px-3 py-2 text-xs text-warn">
          {cmp.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-between gap-x-4 border-t border-line px-3 py-1.5 text-[11px] text-muted">
        <span>
          {x.errors.length > 0 && (
            <span className="text-warn">{x.errors.map((e) => `${e.exchange}: ${e.message}`).join(" · ")} · </span>
          )}
          {cmp.rows.length} venue{cmp.rows.length === 1 ? "" : "s"}
          {age !== null && ` · updated ${age}s ago`}
          {x.error && <span className="text-warn"> · refresh failed, showing last data</span>}
        </span>
        <span>
          Matched by base asset name · funding normalised to 8h · OI/volume shares cover the venues shown only
        </span>
      </div>
    </section>
  );
}
