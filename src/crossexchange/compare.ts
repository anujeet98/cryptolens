import type { ExchangeId } from "@/types/market";

/** Raw per-exchange perp data for one coin, as returned by /api/xchange. */
export interface ExchangeRow {
  exchange: ExchangeId;
  symbol: string;
  price: number; // last
  mark: number;
  index: number;
  fundingRate: number; // per funding interval
  fundingIntervalHours: number;
  nextFundingTime: number; // ms
  oiUsd: number;
  volume24hUsd: number;
  changePct24h: number;
}

export interface CompareRow extends ExchangeRow {
  funding8h: number; // fraction per 8h
  fundingApr: number; // fraction per year, simple (not compounded)
  markVsRefBps: number; // (mark - ref mark) / ref mark
  premiumBps: number; // (mark - index) / index
  oiSharePct: number;
  volumeSharePct: number;
  suspect: boolean; // price differs so much from the reference that the contracts are probably not the same size
}

export interface Comparison {
  ref: ExchangeId;
  rows: CompareRow[];
  oiTotalUsd: number;
  volumeTotalUsd: number;
  fundingSpread8hBps: number; // max - min across venues
  markSpreadBps: number;
  notes: string[];
}

/** Marks further apart than this are almost certainly different contract multipliers, not a real basis. */
export const SUSPECT_BPS = 200;
const FUNDING_NOTE_BPS = 2; // 8h-equivalent spread worth pointing out (baseline funding is 1 bp / 8h)
const MARK_NOTE_BPS = 5;
const CONCENTRATION_PCT = 70;

export const to8h = (rate: number, intervalHours: number) => (rate * 8) / (intervalHours > 0 ? intervalHours : 8);
const bps = (x: number) => x * 10_000;

/** Compare venues for one coin. Funding is normalised to 8h; price is compared on mark price against `ref`. */
export function compareExchanges(input: ExchangeRow[], ref: ExchangeId = "binance"): Comparison | null {
  const rows0 = input.filter((r) => r.mark > 0 && isFinite(r.mark));
  if (!rows0.length) return null;
  const base = rows0.find((r) => r.exchange === ref) ?? rows0[0];

  const withDev = rows0.map((r) => ({ r, dev: bps((r.mark - base.mark) / base.mark) }));
  const good = withDev.filter((x) => Math.abs(x.dev) <= SUSPECT_BPS);
  const oiTotalUsd = good.reduce((s, x) => s + x.r.oiUsd, 0);
  const volumeTotalUsd = good.reduce((s, x) => s + x.r.volume24hUsd, 0);

  const rows: CompareRow[] = withDev.map(({ r, dev }) => {
    const suspect = Math.abs(dev) > SUSPECT_BPS;
    const f8 = to8h(r.fundingRate, r.fundingIntervalHours);
    return {
      ...r,
      funding8h: f8,
      fundingApr: f8 * 3 * 365,
      markVsRefBps: dev,
      premiumBps: r.index > 0 ? bps((r.mark - r.index) / r.index) : 0,
      oiSharePct: !suspect && oiTotalUsd > 0 ? (r.oiUsd / oiTotalUsd) * 100 : 0,
      volumeSharePct: !suspect && volumeTotalUsd > 0 ? (r.volume24hUsd / volumeTotalUsd) * 100 : 0,
      suspect,
    };
  });

  const valid = rows.filter((r) => !r.suspect);
  const f = valid.map((r) => r.funding8h);
  const m = valid.map((r) => r.mark);
  const fundingSpread8hBps = f.length > 1 ? bps(Math.max(...f) - Math.min(...f)) : 0;
  const markSpreadBps = m.length > 1 ? bps((Math.max(...m) - Math.min(...m)) / base.mark) : 0;

  const notes: string[] = [];
  if (rows.some((r) => r.suspect))
    notes.push(
      `${rows
        .filter((r) => r.suspect)
        .map((r) => r.exchange)
        .join(
          ", ",
        )}: mark price is >${SUSPECT_BPS / 100}% from ${base.exchange}, so the contract size probably differs. Excluded from totals and spreads.`,
    );
  if (valid.length > 1 && fundingSpread8hBps >= FUNDING_NOTE_BPS) {
    const hi = valid.reduce((a, b) => (b.funding8h > a.funding8h ? b : a));
    const lo = valid.reduce((a, b) => (b.funding8h < a.funding8h ? b : a));
    notes.push(
      `Funding differs by ${fundingSpread8hBps.toFixed(1)} bps per 8h: ${hi.exchange} is highest, ${lo.exchange} lowest. Crowding on one venue is not necessarily crowding market-wide.`,
    );
  }
  if (valid.length > 1 && markSpreadBps >= MARK_NOTE_BPS)
    notes.push(
      `Mark prices are ${markSpreadBps.toFixed(1)} bps apart across venues, which is wider than usual for a liquid coin.`,
    );
  const top = valid.reduce<CompareRow | null>((a, b) => (!a || b.oiSharePct > a.oiSharePct ? b : a), null);
  if (valid.length > 1 && top && top.oiSharePct >= CONCENTRATION_PCT)
    notes.push(
      `${top.exchange} holds ${top.oiSharePct.toFixed(0)}% of open interest among the venues shown, so its data dominates any single-venue read.`,
    );

  return { ref: base.exchange, rows, oiTotalUsd, volumeTotalUsd, fundingSpread8hBps, markSpreadBps, notes };
}
