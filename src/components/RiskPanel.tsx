import { TF_SECONDS } from "@/analysis/volume";
import type { Regime } from "@/regime/regime";
import { forecastRanges, regimeHint, windowLabel } from "@/risk/forecast";
import { fmtPrice } from "@/lib/format";
import type { Timeframe } from "@/types/market";

/** Distance in quote currency, readable at any price level (BTC: $218, SOL: $0.31, PEPE: $0.00001234). */
const dist = (v: number) =>
  v >= 100 ? `$${Math.round(v).toLocaleString("en-US")}` : v >= 1 ? `$${v.toFixed(2)}` : `$${fmtPrice(v)}`;

const Title = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</div>
);

export function RiskPanel({ r, price, tf }: { r: Regime | null; price: number | null; tf: Timeframe }) {
  if (!r || !price) {
    return (
      <section className="rounded border border-line bg-panel p-4 text-sm text-muted">
        Expected range: waiting for enough candles on {tf}.
      </section>
    );
  }
  const rows = forecastRanges(r.atrPct);
  const hint = regimeHint(r.volatility);
  const cell = (pct: number) => (
    <>
      <span className="num">{pct.toFixed(2)}%</span>
      <span className="num ml-1 text-[11px] text-muted">{dist((price * pct) / 100)}</span>
    </>
  );

  return (
    <section className="rounded border border-line bg-panel">
      <div className="grid md:grid-cols-3">
        <div className="border-line p-3 md:col-span-2 md:border-r">
          <Title>
            Expected range · how far price tends to travel · {tf} candles, ATR {r.atrPct.toFixed(2)}%
          </Title>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase text-muted">
                <th className="text-left font-normal">Next</th>
                <th className="text-right font-normal">Typical (median)</th>
                <th className="text-right font-normal">Wide (~1 in 5 exceed)</th>
                <th className="text-right font-normal">Very wide (~1 in 8 exceed)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.h} className="border-t border-line">
                  <td className="py-1">
                    <span className="font-medium">{windowLabel(x.h, TF_SECONDS[tf])}</span>{" "}
                    <span className="text-[11px] text-muted">({x.h} bars)</span>
                  </td>
                  <td className="text-right">{cell(x.p50)}</td>
                  <td className="text-right">{cell(x.p80)}</td>
                  <td className="text-right">{cell(x.p90)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            Range = highest high minus lowest low over the window. It says how much price moves, not which way. Figures
            scale with the current ATR, so they widen and narrow with the market.
          </p>
        </div>
        <div className="p-3">
          <Title>Reading it</Title>
          <ul className="space-y-1.5 text-xs">
            <li>
              A stop placed farther from entry than the <span className="font-medium">very wide</span> figure would
              rarely have been hit by noise alone. That is an upper bound: a move in one direction cannot exceed the
              total range.
            </li>
            <li>
              A stop inside the <span className="font-medium">typical</span> figure sits within ordinary noise. That
              does not mean it will be hit, only that it is not far outside what routine movement covers.
            </li>
            {hint && <li className="text-warn">{hint}</li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
        Calibrated on 2 years of BTC, ETH and SOL candles (15m, 1h, 4h). Scored out of sample, the median, wide and
        very-wide figures held about 47–53%, 77–86% and 88–93% of the time; the upper end ran slightly short on 15m and
        1h. A statistical estimate of size, not a forecast of direction or a guarantee.
      </div>
    </section>
  );
}
