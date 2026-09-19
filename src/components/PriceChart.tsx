"use client";
import { useEffect, useRef } from "react";
import {
  CandlestickSeries, HistogramSeries, createChart,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/types/market";

const UP = "#22c55e", DOWN = "#ef4444";

export function PriceChart({ candles, resetKey }: { candles: Candle[]; resetKey: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const cs = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vs = useRef<ISeriesApi<"Histogram"> | null>(null);
  const loadedKey = useRef("");

  useEffect(() => {
    const c = createChart(el.current!, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#8b93a7", fontFamily: "inherit" },
      grid: { vertLines: { color: "#161b28" }, horzLines: { color: "#161b28" } },
      rightPriceScale: { borderColor: "#1f2637" },
      timeScale: { borderColor: "#1f2637", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    cs.current = c.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false,
      priceFormat: { type: "price", precision: 6, minMove: 0.000001 },
    });
    vs.current = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.current = c;
    return () => c.remove();
  }, []);

  useEffect(() => {
    if (!candles.length || !cs.current || !vs.current) return;
    const isNewSet = loadedKey.current !== resetKey;
    const toBar = (c: Candle) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
    const toVol = (c: Candle) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "#22c55e55" : "#ef444455" });
    if (isNewSet) {
      const last = candles[candles.length - 1].close;
      const precision = last >= 100 ? 2 : last >= 1 ? 4 : last >= 0.01 ? 5 : 8;
      cs.current.applyOptions({ priceFormat: { type: "price", precision, minMove: 10 ** -precision } });
      cs.current.setData(candles.map(toBar));
      vs.current.setData(candles.map(toVol));
      chart.current?.timeScale().fitContent();
      loadedKey.current = resetKey;
    } else {
      const c = candles[candles.length - 1];
      cs.current.update(toBar(c));
      vs.current.update(toVol(c));
    }
  }, [candles, resetKey]);

  return <div ref={el} className="h-full w-full" />;
}
