import { FUNDING_LABEL, fundingContext, type FundingAnalysis } from "@/analysis/funding";
import { REGIME_TEXT, type OiAnalysis } from "@/analysis/openInterest";
import type { DerivativesState } from "@/hooks/useDerivatives";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/format";

const sign = (v: number) => (v > 0 ? "text-bull" : v < 0 ? "text-bear" : "text-muted");

function Row({ k, v, cls = "" }: { k: string; v: React.ReactNode; cls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted">{k}</span>
      <span className={`num text-right ${cls}`}>{v}</span>
    </div>
  );
}
const Title = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</div>
);

export const pctFmt = (r: number, d = 4) => `${r >= 0 ? "+" : ""}${(r * 100).toFixed(d)}%`;

const fundingCls = (c: FundingAnalysis["class"]) =>
  c === "EXTREMELY_POSITIVE" || c === "EXTREMELY_NEGATIVE"
    ? "text-warn"
    : c === "POSITIVE"
      ? "text-bull"
      : c === "NEGATIVE"
        ? "text-bear"
        : "text-muted";

export function DerivativesPanel({
  st,
  funding,
  oi,
  symbol,
  now,
  nextFundingIn,
}: {
  st: DerivativesState;
  funding: FundingAnalysis | null;
  oi: OiAnalysis | null;
  symbol: string | null;
  now: number;
  nextFundingIn: string;
}) {
  if (!symbol)
    return (
      <section className="rounded border border-line bg-panel p-4 text-sm text-muted">
        No perpetual market found for this coin — derivatives data unavailable.
      </section>
    );
  const d = st.data;
  if (!d)
    return (
      <section className="rounded border border-line bg-panel p-4 text-sm text-muted">
        {st.error ? `Derivatives: ${st.error}` : "Loading derivatives…"}
      </section>
    );
  const age = Math.round((now - st.fetchedAt) / 1000);
  const w1h = oi?.windows.find((w) => w.label === "1h");
  const ctx = funding ? fundingContext(funding.class, w1h?.priceChangePct ?? 0) : null;
  const ls = d.ls.at(-1),
    lsPrev = d.ls.length > 12 ? d.ls[d.ls.length - 13] : null;
  const premium = ((d.snapshot.markPrice - d.snapshot.indexPrice) / d.snapshot.indexPrice) * 100;

  return (
    <section className="rounded border border-line bg-panel">
      <div className="grid md:grid-cols-3">
        <div className="border-line p-3 md:border-r">
          <Title>Funding · {symbol}</Title>
          <div className="text-xs">
            <Row k="Current" v={pctFmt(d.snapshot.fundingRate)} cls={funding ? fundingCls(funding.class) : ""} />
            {funding && (
              <>
                <Row k="Class" v={FUNDING_LABEL[funding.class]} cls={fundingCls(funding.class)} />
                <Row k={`Per 8h (${funding.intervalHours}h interval)`} v={pctFmt(funding.rate8h)} />
                <Row k="Annualized" v={`${funding.annualizedPct.toFixed(1)}%`} cls={sign(funding.annualizedPct)} />
                <Row
                  k="Percentile 7d"
                  v={
                    funding.percentile7d === null
                      ? "n/a"
                      : `${funding.percentile7d.toFixed(0)}th (${funding.samples7d})`
                  }
                />
                <Row
                  k="Percentile 30d"
                  v={
                    funding.percentile30d === null
                      ? "n/a"
                      : `${funding.percentile30d.toFixed(0)}th (${funding.samples30d})`
                  }
                />
                <Row
                  k="Change vs last"
                  v={funding.change === null ? "n/a" : pctFmt(funding.change)}
                  cls={funding.change ? sign(funding.change) : ""}
                />
              </>
            )}
            <Row k="Next funding" v={nextFundingIn} />
            <Row k="Mark / Index" v={`${fmtPrice(d.snapshot.markPrice)} / ${fmtPrice(d.snapshot.indexPrice)}`} />
            <Row k="Mark premium" v={fmtPct(premium)} cls={sign(premium)} />
            <p className="mt-1 text-[11px] leading-snug text-muted">
              {ctx ?? "Funding is context, not a standalone signal."}
            </p>
          </div>
        </div>

        <div className="border-line p-3 md:border-r">
          <Title>Open interest</Title>
          <div className="text-xs">
            <Row k="OI (notional)" v={fmtUsd(d.snapshot.openInterestUsd)} />
            <Row k="OI (contracts)" v={d.snapshot.openInterest.toLocaleString("en-US", { maximumFractionDigits: 0 })} />
            {oi?.windows.map((w) => (
              <Row
                key={w.label}
                k={`Δ ${w.label}`}
                v={w.oiChangePct === null ? "n/a" : fmtPct(w.oiChangePct)}
                cls={w.oiChangePct === null ? "text-muted" : sign(w.oiChangePct)}
              />
            ))}
            {oi?.zScore != null && (
              <Row
                k={`vs ${oi.zWindowHours}h mean`}
                v={`${oi.zScore >= 0 ? "+" : ""}${oi.zScore.toFixed(1)}σ · ${oi.percentile!.toFixed(0)}th pct`}
                cls={Math.abs(oi.zScore) >= 2 ? "text-warn" : ""}
              />
            )}
          </div>
        </div>

        <div className="p-3">
          <Title>Likely positioning interpretation</Title>
          <div className="text-xs">
            {oi?.windows
              .filter((w) => ["15m", "1h", "4h"].includes(w.label) && w.regime)
              .map((w) => (
                <div key={w.label} className="mb-1.5">
                  <div className="flex justify-between">
                    <span className="text-muted">{w.label}</span>
                    <span className="num text-muted">
                      {REGIME_TEXT[w.regime!].title} · px {fmtPct(w.priceChangePct!)} · OI {fmtPct(w.oiChangePct!)}
                    </span>
                  </div>
                  <div className="leading-snug">{REGIME_TEXT[w.regime!].text}</div>
                </div>
              ))}
            <p className="text-[11px] leading-snug text-muted">
              Heuristic reading of price + OI: OI shows positions opening or closing, not which side is right.
            </p>
            <div className="mt-2 border-t border-line pt-2">
              <Title>Long / short accounts</Title>
              {ls ? (
                <>
                  <Row k="Ratio" v={ls.ratio.toFixed(2)} cls={ls.ratio > 1 ? "text-bull" : "text-bear"} />
                  <Row k="Long / Short" v={`${(ls.longPct * 100).toFixed(1)}% / ${(ls.shortPct * 100).toFixed(1)}%`} />
                  {lsPrev && (
                    <Row
                      k="Ratio Δ 1h"
                      v={(ls.ratio - lsPrev.ratio >= 0 ? "+" : "") + (ls.ratio - lsPrev.ratio).toFixed(2)}
                      cls={sign(ls.ratio - lsPrev.ratio)}
                    />
                  )}
                  <p className="text-[11px] text-muted">
                    Binance global account ratio (retail-weighted; not position size).
                  </p>
                </>
              ) : (
                <span className="text-muted">n/a</span>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-between border-t border-line px-3 py-1.5 text-[11px] text-muted">
        <span>
          Binance perp · funding/OI/L-S updated {age}s ago{age > 20 ? " — STALE" : ""}
        </span>
        <span>OI history resolution 5m · OI z-score uses the loaded window only</span>
      </div>
    </section>
  );
}
