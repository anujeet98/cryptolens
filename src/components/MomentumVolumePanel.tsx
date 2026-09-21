import type { MomentumResult } from "@/analysis/momentum";
import { PRICE_VOLUME_TEXT, type VolumeAnalysis, type VolumeWindow } from "@/analysis/volume";
import { fmtPct, fmtUsd } from "@/lib/format";
import type { Ticker24h, Timeframe } from "@/types/market";

const dirCls = (v: number) => (v > 0 ? "text-bull" : v < 0 ? "text-bear" : "text-muted");

function Row({ k, v, cls = "" }: { k: string; v: React.ReactNode; cls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted">{k}</span>
      <span className={`num text-right ${cls}`}>{v}</span>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  const pct = Math.min(50, Math.abs(value) * 50);
  return (
    <div className="relative h-1.5 w-24 rounded bg-white/5">
      <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
      <div
        className={`absolute inset-y-0 rounded ${value >= 0 ? "bg-bull" : "bg-bear"}`}
        style={value >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
      />
    </div>
  );
}

export function MomentumVolumePanel({
  m,
  v,
  windows,
  ticker,
  tf,
}: {
  m: MomentumResult | null;
  v: VolumeAnalysis | null;
  windows: VolumeWindow[];
  ticker: Ticker24h | null;
  tf: Timeframe;
}) {
  const stateCls = (s: string) =>
    s === "EXPANSION"
      ? "text-warn"
      : s === "CLIMAX"
        ? "text-squeeze"
        : s === "CONTRACTION"
          ? "text-muted"
          : "text-foreground";
  return (
    <section className="grid rounded border border-line bg-panel md:grid-cols-2">
      <div className="border-line p-3 md:border-r">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Momentum · {tf}</div>
        {!m ? (
          <span className="text-xs text-muted">Waiting for history…</span>
        ) : (
          <>
            <div className="flex items-end gap-4">
              <div className={`num text-3xl font-semibold ${dirCls(m.score)}`}>
                {m.score >= 0 ? "+" : ""}
                {m.score.toFixed(0)}
                <span className="text-sm text-muted"> / 100</span>
              </div>
              <div className="pb-1 text-xs">
                <div
                  className={
                    m.trend === "DECELERATING"
                      ? "text-warn"
                      : m.trend === "ACCELERATING"
                        ? "text-foreground"
                        : "text-muted"
                  }
                >
                  {m.direction} · {m.condition}
                </div>
                <div className="num text-muted">
                  acceleration {m.accelerationPts >= 0 ? "+" : ""}
                  {m.accelerationPts.toFixed(1)} pts / 3 bars
                </div>
              </div>
            </div>
            <div className="mt-3 text-xs">
              {m.components.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-3 py-0.5">
                  <span className="text-muted">{c.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="num text-muted">{c.detail}</span>
                    <Bar value={c.value} />
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted">
              Composite of price-derived inputs plus independent volume confirmation. STRONG / DECELERATING means a
              strong move that is losing speed — not a reversal by itself.
            </p>
          </>
        )}
      </div>

      <div className="p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Volume · {tf} (quote)</div>
        {!v ? (
          <span className="text-xs text-muted">Waiting for history…</span>
        ) : (
          <div className="text-xs">
            <Row k="Current candle" v={fmtUsd(v.currentQuote)} />
            <Row
              k="Relative volume"
              v={
                <>
                  {v.relativeVolume.toFixed(2)}x
                  {v.projectedRelative !== null && (
                    <span className="text-muted"> · pace {v.projectedRelative.toFixed(2)}x</span>
                  )}
                </>
              }
              cls={stateCls(v.state)}
            />
            <Row k="20-bar average" v={fmtUsd(v.avgQuote)} />
            <Row k="State" v={v.state} cls={stateCls(v.state)} />
            <Row k="Price (10 bars)" v={fmtPct(v.priceChangePct)} cls={dirCls(v.priceChangePct)} />
            <Row k="Volume (5 vs prev 5)" v={fmtPct(v.volumeChangePct)} cls={dirCls(v.volumeChangePct)} />
            <p className="my-1 text-[11px] leading-snug text-muted">{PRICE_VOLUME_TEXT[v.priceVolume]}</p>
            <div className="mt-2 border-t border-line pt-2">
              {windows.length === 0 && <span className="text-muted">Loading windows…</span>}
              {windows.map((w) => (
                <Row
                  key={w.label}
                  k={`Last ${w.label}`}
                  v={
                    <>
                      {fmtUsd(w.quote)}{" "}
                      {w.ratio !== null && <span className={dirCls(w.ratio - 1)}>{w.ratio.toFixed(2)}x prev</span>}
                    </>
                  }
                />
              ))}
              {ticker && <Row k="24h" v={fmtUsd(ticker.quoteVolume)} />}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
