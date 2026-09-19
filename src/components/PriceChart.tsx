"use client";
import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries, HistogramSeries, LineSeries, LineStyle, LineType, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { alignStep } from "@/lib/align";
import { TF_SECONDS } from "@/analysis/volume";
import { bollinger, ema, macd, pivots, rsi, vwap, type Series } from "@/indicators";
import type { Candle, FundingPoint, OiPoint, Timeframe } from "@/types/market";

export interface Toggles {
  ema9: boolean; ema20: boolean; ema50: boolean; ema100: boolean; ema200: boolean;
  vwap: boolean; bb: boolean; swings: boolean; rsi: boolean; macd: boolean; oi: boolean; funding: boolean;
}
export const DEFAULT_TOGGLES: Toggles = {
  ema9: false, ema20: true, ema50: true, ema100: false, ema200: true,
  vwap: true, bb: false, swings: true, rsi: true, macd: true, oi: true, funding: false,
};
export const EMA_COLORS: Record<number, string> = { 9: "#facc15", 20: "#38bdf8", 50: "#a78bfa", 100: "#fb923c", 200: "#e5e7eb" };

const UP = "#22c55e", DOWN = "#ef4444";
type Line = ISeriesApi<"Line">;

const compactUsd = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0));
const line = (t: number, v: number | null) => (v === null ? null : { time: t as UTCTimestamp, value: v });

export function PriceChart({ candles, resetKey, toggles, tf, oi, funding }: {
  candles: Candle[]; resetKey: string; toggles: Toggles; tf: Timeframe; oi: OiPoint[]; funding: FundingPoint[];
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const cs = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vs = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const extras = useRef<{ series: ISeriesApi<"Line" | "Histogram">; get: () => Series | ((c: Candle, i: number) => { value: number; color: string } | null) }[]>([]);
  const priceLines = useRef<IPriceLine[]>([]);
  const loadedKey = useRef("");
  const data = useRef<ReturnType<typeof compute> | null>(null);

  const ind = useMemo(() => compute(candles, tf, oi, funding), [candles, tf, oi, funding]);

  useEffect(() => {
    const c = createChart(el.current!, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#8b93a7", fontFamily: "inherit", panes: { separatorColor: "#1f2637" } },
      grid: { vertLines: { color: "#161b28" }, horzLines: { color: "#161b28" } },
      rightPriceScale: { borderColor: "#1f2637" },
      timeScale: { borderColor: "#1f2637", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    cs.current = c.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false });
    vs.current = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    markers.current = createSeriesMarkers(cs.current, []);
    chart.current = c;
    return () => {
      // Strict Mode re-runs effects: drop refs to series owned by the chart being destroyed.
      extras.current = [];
      priceLines.current = [];
      loadedKey.current = "";
      c.remove();
    };
  }, []);

  // Structure: (re)create indicator series whenever a toggle flips.
  useEffect(() => {
    const c = chart.current!;
    extras.current.forEach((e) => c.removeSeries(e.series));
    extras.current = [];
    const opt = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, lineWidth: 1 as const };
    const add = (color: string, get: () => Series, pane = 0, extra: object = {}) => {
      const s: Line = c.addSeries(LineSeries, { ...opt, color, ...extra }, pane);
      extras.current.push({ series: s, get });
      return s;
    };
    for (const p of [9, 20, 50, 100, 200] as const)
      if (toggles[`ema${p}` as keyof Toggles]) add(EMA_COLORS[p], () => data.current!.ema[p]);
    if (toggles.vwap) {
      add("#f472b6", () => data.current!.vwapDay, 0, { lineStyle: LineStyle.Dashed });
    }
    if (toggles.bb) {
      add("#64748b", () => data.current!.bb.upper);
      add("#64748b", () => data.current!.bb.lower);
      add("#475569", () => data.current!.bb.mid, 0, { lineStyle: LineStyle.Dotted });
    }
    let pane = 1;
    if (toggles.rsi) {
      const s = add("#c084fc", () => data.current!.rsi14, pane, { lineWidth: 2 });
      s.createPriceLine({ price: 70, color: "#ef444466", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
      s.createPriceLine({ price: 30, color: "#22c55e66", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
      pane++;
    }
    if (toggles.macd) {
      const h = c.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, pane);
      extras.current.push({ series: h, get: () => (cd, i) => {
        const v = data.current!.macd.hist[i];
        return v === null ? null : { value: v, color: v >= 0 ? "#22c55e88" : "#ef444488" };
      } });
      add("#38bdf8", () => data.current!.macd.macd, pane);
      add("#f59e0b", () => data.current!.macd.signal, pane);
      pane++;
    }
    if (toggles.oi) {
      add("#2dd4bf", () => data.current!.oiUsd, pane, { lineWidth: 2, priceFormat: { type: "custom", minMove: 1, formatter: compactUsd } });
      pane++;
    }
    if (toggles.funding) {
      add("#f59e0b", () => data.current!.funding, pane, { lineWidth: 2, lineType: LineType.WithSteps, priceFormat: { type: "custom", minMove: 0.0001, formatter: (v: number) => `${v.toFixed(4)}%` } });
      pane++;
    }
    const panes = c.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 6 : 1.4));
    loadedKey.current = ""; // force full data reload
  }, [toggles]);

  useEffect(() => {
    if (!candles.length || !cs.current || !vs.current) return;
    data.current = ind;
    const full = loadedKey.current !== resetKey;
    const toBar = (c: Candle) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
    const toVol = (c: Candle) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "#22c55e44" : "#ef444444" });
    const lastIdx = candles.length - 1;

    const feed = (get: () => Series | ((c: Candle, i: number) => { value: number; color: string } | null)) => {
      const g = get();
      return typeof g === "function"
        ? (i: number) => { const r = g(candles[i], i); return r ? { time: candles[i].time as UTCTimestamp, ...r } : null; }
        : (i: number) => line(candles[i].time, g[i]);
    };

    if (full) {
      const last = candles[lastIdx].close;
      const precision = last >= 100 ? 2 : last >= 1 ? 4 : last >= 0.01 ? 5 : 8;
      cs.current.applyOptions({ priceFormat: { type: "price", precision, minMove: 10 ** -precision } });
      cs.current.setData(candles.map(toBar));
      vs.current.setData(candles.map(toVol));
      for (const e of extras.current) {
        const f = feed(e.get);
        e.series.setData(candles.map((_, i) => f(i)).filter((x) => x !== null) as never[]);
      }
      chart.current?.timeScale().fitContent();
      loadedKey.current = resetKey;
    } else {
      cs.current.update(toBar(candles[lastIdx]));
      vs.current.update(toVol(candles[lastIdx]));
      for (const e of extras.current) {
        const p = feed(e.get)(lastIdx);
        if (p) e.series.update(p as never);
      }
    }

    // Swing markers + nearest support/resistance from confirmed pivots.
    const pv = { hi: pivots(candles.map((c) => c.high), 5, 5, "high"), lo: pivots(candles.map((c) => c.low), 5, 5, "low") };
    const mk: SeriesMarker<Time>[] = toggles.swings
      ? [
          ...pv.hi.slice(-8).map((p) => ({ time: candles[p.index].time as UTCTimestamp, position: "aboveBar" as const, color: "#f59e0b", shape: "circle" as const, size: 0.5 })),
          ...pv.lo.slice(-8).map((p) => ({ time: candles[p.index].time as UTCTimestamp, position: "belowBar" as const, color: "#38bdf8", shape: "circle" as const, size: 0.5 })),
        ].sort((a, b) => (a.time as number) - (b.time as number))
      : [];
    markers.current?.setMarkers(mk);
    priceLines.current.forEach((l) => cs.current!.removePriceLine(l));
    priceLines.current = [];
    if (toggles.swings) {
      const price = candles[lastIdx].close;
      const res = pv.hi.filter((p) => p.price > price).sort((a, b) => a.price - b.price)[0];
      const sup = pv.lo.filter((p) => p.price < price).sort((a, b) => b.price - a.price)[0];
      if (res) priceLines.current.push(cs.current.createPriceLine({ price: res.price, color: "#ef444499", lineStyle: LineStyle.Dashed, lineWidth: 1, title: "R" }));
      if (sup) priceLines.current.push(cs.current.createPriceLine({ price: sup.price, color: "#22c55e99", lineStyle: LineStyle.Dashed, lineWidth: 1, title: "S" }));
    }
  }, [candles, ind, resetKey, toggles]);

  return <div ref={el} className="h-full w-full" />;
}

function compute(candles: Candle[], tf: Timeframe, oi: OiPoint[], funding: FundingPoint[]) {
  const close = candles.map((c) => c.close);
  return {
    ema: { 9: ema(close, 9), 20: ema(close, 20), 50: ema(close, 50), 100: ema(close, 100), 200: ema(close, 200) } as Record<number, Series>,
    vwapDay: vwap(candles, "day"),
    bb: bollinger(close, 20, 2),
    rsi14: rsi(close, 14),
    macd: macd(close),
    oiUsd: alignStep(candles, oi, TF_SECONDS[tf], (p) => p.oiUsd),
    funding: alignStep(candles, funding, TF_SECONDS[tf], (p) => p.rate * 100),
  };
}
