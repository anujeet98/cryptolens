import type { LiquidationState } from "@/hooks/useLiquidations";
import { fmtPrice, fmtUsd } from "@/lib/format";

const Title = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</div>
);

export function LiquidationsPanel({ liq, symbol, now }: { liq: LiquidationState; symbol: string | null; now: number }) {
  const s = liq.snap;
  const sinceLast = liq.lastEventAt ? Math.round((now - liq.lastEventAt) / 1000) : null;
  const badge = liq.status === "live" ? { t: "LIVE", c: "text-bull" } : { t: liq.status === "reconnecting" ? "RECONNECTING" : "CONNECTING", c: "text-warn" };

  if (!symbol) {
    return <section className="rounded border border-line bg-panel p-4 text-sm text-muted">Liquidations: no perpetual market for this coin.</section>;
  }
  if (!s) {
    return <section className="rounded border border-line bg-panel p-4 text-sm text-muted">Liquidations: connecting to the market-wide feed…</section>;
  }

  const w15 = s.windows.find((w) => w.label === "15m")!;
  const b = s.burst;
  const mk = s.market;
  const mkTotal = mk.longUsd + mk.shortUsd;

  return (
    <section className="rounded border border-line bg-panel">
      <div className="grid md:grid-cols-3">
        <div className="border-line p-3 md:border-r">
          <Title>Liquidations · {symbol} perp</Title>
          <table className="w-full text-xs">
            <thead><tr className="text-[10px] uppercase text-muted"><th className="text-left font-normal">Window</th><th className="text-right font-normal">Longs liq.</th><th className="text-right font-normal">Shorts liq.</th><th className="text-right font-normal">#</th></tr></thead>
            <tbody>
              {s.windows.map((w) => (
                <tr key={w.label} className={w.covered ? "" : "text-muted"} title={w.covered ? undefined : `Only ${Math.round(s.collectedSec / 60)}m collected since connect: partial window`}>
                  <td className="num py-px">{w.label}{w.covered ? "" : "*"}</td>
                  <td className="num text-right text-bear">{fmtUsd(w.longUsd)}</td>
                  <td className="num text-right text-bull">{fmtUsd(w.shortUsd)}</td>
                  <td className="num text-right">{w.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-xs">
            {b.active
              ? <span className="font-medium text-warn">Liquidation burst: {b.dominant === "long" ? "longs" : "shorts"} being flushed · {fmtUsd(b.lastMinUsd)} in the last minute vs {fmtUsd(b.avgMinUsd)}/min average</span>
              : <span className="text-muted">No burst. {w15.count === 0 ? "No liquidations on this symbol in 15m." : `Largest in 15m: ${fmtUsd(w15.largest)}.`}</span>}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">A long is liquidated by a forced sell (red); a short by a forced buy (green). * = window not fully collected yet.</p>
        </div>

        <div className="border-line p-3 md:border-r">
          <Title>Recent · {symbol}</Title>
          <div className="max-h-44 overflow-auto text-xs">
            {s.recent.length === 0 && <span className="text-muted">None since the feed connected.</span>}
            {s.recent.map((e, i) => (
              <div key={`${e.t}-${i}`} className="flex justify-between py-0.5">
                <span className={e.side === "long" ? "text-bear" : "text-bull"}>{e.side === "long" ? "Long liq." : "Short liq."} @ {fmtPrice(e.price)}</span>
                <span className="num text-muted">{fmtUsd(e.usd)} · {Math.max(0, Math.round((now - e.t) / 1000))}s ago</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3">
          <div className="mb-1 flex items-baseline justify-between">
            <Title>Market-wide · 15m</Title>
            <span className="num text-xs text-muted">{fmtUsd(mkTotal)} · {mk.count} events</span>
          </div>
          <div className="mb-2 flex h-1.5 overflow-hidden rounded bg-line" title="Longs liquidated (red) vs shorts liquidated (green)">
            {mkTotal > 0 && <><div className="bg-bear" style={{ width: `${(mk.longUsd / mkTotal) * 100}%` }} /><div className="bg-bull" style={{ width: `${(mk.shortUsd / mkTotal) * 100}%` }} /></>}
          </div>
          <div className="text-xs">
            {mk.top.length === 0 && <span className="text-muted">Nothing yet.</span>}
            {mk.top.map((t) => (
              <div key={t.symbol} className="flex justify-between py-0.5">
                <span className={t.symbol === symbol ? "font-medium" : ""}>{t.symbol}</span>
                <span className="num text-muted"><span className="text-bear">{fmtUsd(t.longUsd)}</span> / <span className="text-bull">{fmtUsd(t.shortUsd)}</span> · {t.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-between border-t border-line px-3 py-1.5 text-[11px] text-muted">
        <span>Binance futures · feed <span className={`font-medium ${badge.c}`}>{badge.t}</span>{sinceLast !== null && ` · last event ${sinceLast}s ago`}</span>
        <span>Binance sends at most 1 liquidation per symbol per second, so totals are lower bounds · no backfill</span>
      </div>
    </section>
  );
}
