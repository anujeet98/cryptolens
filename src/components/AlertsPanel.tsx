import { useState } from "react";
import { SIGNAL_INFO, type Evidence, type SignalKind } from "@/alerts/engine";
import type { AlertsApi } from "@/hooks/useAlerts";
import { fmtPrice } from "@/lib/format";
import type { MarketType } from "@/types/market";

const Title = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</div>
);
const EVIDENCE: Record<Evidence, { t: string; c: string }> = {
  backtested: { t: "backtested", c: "text-bull" },
  descriptive: { t: "descriptive", c: "text-muted" },
  untested: { t: "untested", c: "text-warn" },
};
const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};

export function AlertsPanel({
  a,
  symbol,
  market,
  tf,
  price,
  now,
}: {
  a: AlertsApi;
  symbol: string;
  market: MarketType;
  tf: string;
  price: number | null;
  now: number;
}) {
  const [level, setLevel] = useState("");
  const [dir, setDir] = useState<"above" | "below">("above");
  const [err, setErr] = useState<string | null>(null);

  const add = () => {
    const v = Number(level);
    if (!level.trim() || !isFinite(v) || v <= 0) return setErr("Enter a price above zero.");
    if (price !== null && Math.abs(v - price) / price < 0.00005)
      return setErr("That is the current price. Pick a level away from it.");
    if (price !== null && dir === "above" && v <= price)
      return setErr(`Price is already above ${fmtPrice(v)}. Choose "falls below", or a higher level.`);
    if (price !== null && dir === "below" && v >= price)
      return setErr(`Price is already below ${fmtPrice(v)}. Choose "rises above", or a lower level.`);
    if (!a.addLevel({ symbol, market, level: v, dir })) return setErr("Could not add (limit is 20 levels).");
    setErr(null);
    setLevel("");
  };
  const perm = a.permission;

  return (
    <section className="rounded border border-line bg-panel">
      <div className="grid md:grid-cols-3">
        <div className="border-line p-3 md:border-r">
          <Title>
            Signal alerts · watching {symbol} {tf}
          </Title>
          <div className="space-y-2">
            {(Object.keys(SIGNAL_INFO) as SignalKind[]).map((k) => {
              const info = SIGNAL_INFO[k],
                ev = EVIDENCE[info.evidence];
              return (
                <label key={k} className="flex cursor-pointer gap-2 text-xs" title={info.note}>
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!!a.enabled[k]}
                    onChange={(e) => a.setEnabled(k, e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">{info.label}</span>{" "}
                    <span className={`text-[10px] uppercase ${ev.c}`}>{ev.t}</span>
                    <span className="block text-[11px] leading-snug text-muted">{info.note}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            Fires when a condition turns true, not for a state you opened the page in. Switching coin or timeframe
            restarts the watch. The same alert waits 5 minutes of &quot;clear&quot; to re-arm and 15 minutes between
            repeats.
          </p>
        </div>

        <div className="border-line p-3 md:border-r">
          <Title>Price levels · any coin</Title>
          <div className="flex gap-1 text-xs">
            <select
              value={dir}
              onChange={(e) => setDir(e.target.value as "above" | "below")}
              className="rounded border border-line bg-panel px-1 py-1"
              aria-label="Direction"
            >
              <option value="above">rises above</option>
              <option value="below">falls below</option>
            </select>
            <input
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              inputMode="decimal"
              placeholder={price ? fmtPrice(price) : "price"}
              className="num min-w-0 flex-1 rounded border border-line bg-panel px-2 py-1"
              aria-label={`Price level for ${symbol}`}
            />
            <button onClick={add} className="rounded bg-accent/20 px-2.5 py-1 text-accent hover:bg-accent/30">
              Add {symbol.replace(/USDT$/, "")}
            </button>
          </div>
          {err && <div className="mt-1 text-[11px] text-bear">{err}</div>}
          <div className="mt-2 max-h-40 overflow-auto text-xs">
            {a.levels.length === 0 && (
              <span className="text-muted">No levels set. One-shot: each is removed when it fires.</span>
            )}
            {a.levels.map((l) => {
              const p = a.prices[`${l.symbol}:${l.market}`];
              const away = p ? ((l.level - p) / p) * 100 : null;
              return (
                <div key={l.id} className="flex items-center justify-between py-0.5">
                  <span>
                    {l.symbol} {l.dir === "above" ? "↑ above" : "↓ below"}{" "}
                    <span className="num">{fmtPrice(l.level)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="num text-[11px] text-muted">
                      {away === null ? "…" : `${away >= 0 ? "+" : ""}${away.toFixed(2)}% away`}
                    </span>
                    <button
                      onClick={() => a.removeLevel(l.id)}
                      className="text-muted hover:text-bear"
                      aria-label={`Remove ${l.symbol} level`}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-3">
          <div className="mb-1 flex items-baseline justify-between">
            <Title>Fired {a.unread > 0 ? `· ${a.unread} new` : ""}</Title>
            <span className="flex gap-2 text-[11px]">
              {a.unread > 0 && (
                <button onClick={a.markRead} className="text-accent hover:underline">
                  mark read
                </button>
              )}
              {a.history.length > 0 && (
                <button onClick={a.clearHistory} className="text-muted hover:text-foreground">
                  clear
                </button>
              )}
            </span>
          </div>
          <div className="max-h-40 overflow-auto text-xs">
            {a.history.length === 0 && <span className="text-muted">Nothing has fired yet.</span>}
            {a.history.map((e) => (
              <div key={e.id} className="border-b border-line py-1 last:border-0">
                <div className="flex justify-between">
                  <span className="font-medium">{e.title}</span>
                  <span className="num text-[11px] text-muted">{ago(now - e.ts)} ago</span>
                </div>
                <div className="text-[11px] leading-snug text-muted">{e.detail}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {perm === "granted" && <span className="text-bull">Browser notifications on</span>}
            {perm === "default" && (
              <button onClick={a.requestPermission} className="text-accent hover:underline">
                Enable browser notifications
              </button>
            )}
            {perm === "denied" && <span className="text-warn">Notifications blocked in the browser</span>}
            {perm === "unsupported" && <span className="text-muted">Notifications unsupported here</span>}
            <label className="flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={a.sound} onChange={(e) => a.setSound(e.target.checked)} /> Sound
            </label>
          </div>
        </div>
      </div>
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
        Alerts run in this page: they only fire while it is open (a background service is not built). Signal alerts
        watch the coin on screen; price levels are checked for every coin you add. Nothing here predicts direction.
      </div>
    </section>
  );
}
