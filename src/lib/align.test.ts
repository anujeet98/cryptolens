import { expect, it } from "vitest";
import { alignStep } from "./align";
import type { Candle } from "@/types/market";

const c = (time: number): Candle => ({
  time,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 1,
  quoteVolume: 1,
  closed: true,
});

it("step-aligns without look-ahead", () => {
  const candles = [c(0), c(900), c(1800), c(2700)];
  const pts = [
    { time: 1000, v: 5 },
    { time: 2700, v: 9 },
  ];
  // candle closes at 900, 1800, 2700, 3600
  expect(alignStep(candles, pts, 900, (p) => p.v)).toEqual([null, 5, 9, 9]);
});
