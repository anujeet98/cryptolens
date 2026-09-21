import type { TradeFlowState } from "@/hooks/useTradeFlow";
import type { FlowSignal } from "@/tradeflow/flow";
import { fmtPrice, fmtUsd } from "@/lib/format";

const tone = (v: number) => (v > 0 ? "text-bull" : v < 0 ? "text-bear" : "text-muted");
const SIGNAL: Record<FlowSignal, { t: string; c: string; tip: string }> = {
  BUYERS: { t: "Buyers aggressive", c: "text-bull", tip: "Takers are mostly lifting asks and price is following." },
  SELLERS: { t: "Sellers aggressive", c: "text-bear", tip: "Takers are mostly hitting bids and price is following." },
  BALANCED: { t: "Balanced", c: "text-muted", tip: "No clear taker side." },
  ABSORPTION_BUY: {
    t: "Buying absorbed",
    c: "text-warn",
    tip: "Heavy taker buying but price is not rising: passive sellers may be absorbing it.",
  },
  ABSORPTION_SELL: {
    t: "Selling absorbed",
    c: "text-warn",
    tip: "Heavy taker selling but price is not falling: passive buyers may be absorbing it.",
  },
};

const Title = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</div>
);

function CvdSpark({ series }: { series: { t: number; v: number }[] }) {
  if (series.length < 2) return <div className="h-12 text-[11px] text-muted">Collecting…</div>;
  const w = 240,
    h = 48;
  const t0 = series[0].t,
    t1 = series[series.length - 1].t || t0 + 1;
  const vs = series.map((p) => p.v);
  const lo = Math.min(...vs),
    hi = Math.max(...vs),
    span = hi - lo || 1;
  const pts = series
    .map((p) => `${(((p.t - t0) / Math.max(t1 - t0, 1)) * w).toFixed(1)},${(h - ((p.v - lo) / span) * h).toFixed(1)}`)
    .join(" ");
  const up = series[series.length - 1].v >= series[0].v;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-12 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Cumulative volume delta, last 15 minutes"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={up ? "var(--color-bull)" : "var(--color-bear)"}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function TradeFlowPanel({
  tf,
  now,
  symbol,
  marketLabel,
}: {
  tf: TradeFlowState;
  now: number;
  symbol: string;
  marketLabel: string;
}) {
  const s = tf.snap;
  const age = tf.lastTradeAt ? Math.round((now - tf.lastTradeAt) / 1000) : null;
  const stale = tf.status === "live" && age !== null && age > 30;
  const badge = stale
    ? { t: `QUIET ${age}s`, c: "text-warn" }
    : tf.status === "live"
      ? { t: "LIVE", c: "text-bull" }
      : { t: tf.status === "reconnecting" ? "RECONNECTING" : "CONNECTING", c: "text-warn" };

  if (!s || s.collectedSec === 0) {
    return (
      <section className="rounded border border-line bg-panel p-4 text-sm text-muted">
        Trade flow: waiting for the first trades…
      </section>
    );
  }

  const w5 = s.windows.find((w) => w.label === "5m")!;
  const sig = SIGNAL[w5.signal];
  const largeNet = s.largeBuyUsd - s.largeSellUsd;

  return (
    <section className="rounded border border-line bg-panel">
      <div className="grid md:grid-cols-3">
        <div className="border-line p-3 md:border-r">
          <Title>
            Taker flow · {symbol} {marketLabel}
          </Title>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase text-muted">
                <th className="text-left font-normal">Window</th>
                <th className="text-right font-normal">Buy %</th>
                <th className="text-right font-normal">Delta</th>
                <th className="text-right font-normal">Trades</th>
              </tr>
            </thead>
            <tbody>
              {s.windows.map((w) => (
                <tr
                  key={w.label}
                  className={w.covered ? "" : "text-muted"}
                  title={w.covered ? undefined : `Only ${s.collectedSec}s collected since connect: partial window`}
                >
                  <td className="num py-px">
                    {w.label}
                    {w.covered ? "" : "*"}
                  </td>
                  <td className={`num text-right ${tone(w.buyPct - 50)}`}>{w.buyPct.toFixed(0)}%</td>
                  <td className={`num text-right ${tone(w.deltaUsd)}`}>
                    {w.deltaUsd >= 0 ? "+" : ""}
                    {fmtUsd(w.deltaUsd)}
                  </td>
                  <td className="num text-right">{w.trades.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-xs" title={sig.tip}>
            5m read: <span className={`font-medium ${sig.c}`}>{sig.t}</span>
            <span className="num text-muted">
              {" "}
              · price {w5.priceChangePct >= 0 ? "+" : ""}
              {w5.priceChangePct.toFixed(2)}%
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            Buy % = share of taker (market-order) volume where the buyer was the aggressor. * = window not fully
            collected yet.
          </p>
        </div>

        <div className="border-line p-3 md:border-r">
          <div className="mb-1 flex items-baseline justify-between">
            <Title>Cumulative volume delta</Title>
            <span className={`num text-xs font-medium ${tone(s.cvd)}`}>
              {s.cvd >= 0 ? "+" : ""}
              {fmtUsd(s.cvd)}
            </span>
          </div>
          <CvdSpark series={s.cvdSeries} />
          <p className="mt-1 text-[11px] leading-snug text-muted">
            Running buy minus sell taker volume since this page connected ({Math.round(s.collectedSec / 60)}m ago);
            chart shows the last 15m. Price rising while CVD falls (or the reverse) is a divergence worth a look, not a
            signal by itself.
          </p>
        </div>

        <div className="p-3">
          <div className="mb-1 flex items-baseline justify-between">
            <Title>Large prints (≥ {fmtUsd(s.largeThreshold)})</Title>
            <span className={`num text-xs ${tone(largeNet)}`}>
              net {largeNet >= 0 ? "+" : ""}
              {fmtUsd(largeNet)}
            </span>
          </div>
          <div className="max-h-44 overflow-auto text-xs">
            {s.large.length === 0 && <span className="text-muted">None in the last 15m.</span>}
            {s.large.slice(0, 15).map((l) => (
              <div key={`${l.t}-${l.usd}-${l.price}`} className="flex justify-between py-0.5">
                <span className={l.buy ? "text-bull" : "text-bear"}>
                  {l.buy ? "Buy" : "Sell"} {fmtPrice(l.price)}
                </span>
                <span className="num text-muted">
                  {fmtUsd(l.usd)} · {l.multiple.toFixed(0)}× avg · {Math.max(0, Math.round((now - l.t) / 1000))}s ago
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            Large = 30× the average recent trade (min $10K). A big taker print is one order, not proof of who is right.
          </p>
        </div>
      </div>
      <div className="flex justify-between border-t border-line px-3 py-1.5 text-[11px] text-muted">
        <span>
          Binance · trades <span className={`font-medium ${badge.c}`}>{badge.t}</span>
          {age !== null && ` · last trade ${age}s ago`}
        </span>
        <span>aggTrade stream · history starts at connect (no backfill)</span>
      </div>
    </section>
  );
}
