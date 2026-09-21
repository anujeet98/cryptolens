"use client";
import { useEffect, useRef } from "react";

/**
 * Decorative background: a slowly scrolling synthetic candlestick chart with a glowing price line, plus a soft spotlight that
 * follows the pointer. Purely cosmetic (random data, never a real price). Honours prefers-reduced-motion by drawing one still frame.
 */
export function MarketBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = canvas.current,
      el = root.current;
    if (!cv || !el) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const STEP = 16; // px per candle
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0,
      h = 0,
      dpr = 1,
      raf = 0,
      offset = 0,
      last = 0;
    let candles: { o: number; c: number; hi: number; lo: number }[] = [];
    let price = 0;

    const next = () => {
      const o = price;
      price += (Math.random() - 0.47) * 0.035 + Math.sin(candles.length / 23) * 0.006;
      const c = price;
      const wick = Math.random() * 0.02;
      return { o, c, hi: Math.max(o, c) + wick, lo: Math.min(o, c) - wick };
    };
    const fill = () => {
      while (candles.length < Math.ceil(w / STEP) + 3) candles.push(next());
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = el.clientWidth;
      h = el.clientHeight;
      cv.width = w * dpr;
      cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      candles = [];
      price = 0;
      fill();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      // Scale the series to the middle band of the screen.
      let min = Infinity,
        max = -Infinity;
      for (const k of candles) {
        min = Math.min(min, k.lo);
        max = Math.max(max, k.hi);
      }
      const top = h * 0.18,
        span = h * 0.62,
        rng = Math.max(max - min, 1e-6);
      const y = (v: number) => top + span - ((v - min) / rng) * span;

      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(125,134,155,0.07)";
      for (let gx = -(offset % 80); gx < w; gx += 80) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += 80) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      candles.forEach((k, i) => {
        const x = i * STEP - offset;
        const up = k.c >= k.o;
        ctx.strokeStyle = ctx.fillStyle = up ? "rgba(34,197,94,0.30)" : "rgba(239,68,68,0.30)";
        ctx.beginPath();
        ctx.moveTo(x, y(k.hi));
        ctx.lineTo(x, y(k.lo));
        ctx.stroke();
        const yo = y(k.o),
          yc = y(k.c);
        ctx.fillRect(x - 3.5, Math.min(yo, yc), 7, Math.max(Math.abs(yo - yc), 1.5));
      });

      // Glowing close line with a fade underneath.
      ctx.beginPath();
      candles.forEach((k, i) => {
        const x = i * STEP - offset;
        if (i) ctx.lineTo(x, y(k.c));
        else ctx.moveTo(x, y(k.c));
      });
      ctx.shadowColor = "rgba(59,130,246,0.9)";
      ctx.shadowBlur = 14;
      ctx.strokeStyle = "rgba(96,165,250,0.85)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineTo(candles.length * STEP - offset, h);
      ctx.lineTo(-offset, h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, top, 0, h);
      g.addColorStop(0, "rgba(59,130,246,0.18)");
      g.addColorStop(1, "rgba(59,130,246,0)");
      ctx.fillStyle = g;
      ctx.fill();
    };

    const tick = (t: number) => {
      const dt = last ? Math.min(t - last, 64) : 16;
      last = t;
      offset += dt * 0.022;
      while (offset >= STEP) {
        offset -= STEP;
        candles.shift();
        candles.push(next());
      }
      draw();
      raf = requestAnimationFrame(tick);
    };

    const move = (e: PointerEvent) => {
      el.style.setProperty("--mx", `${e.clientX}px`);
      el.style.setProperty("--my", `${e.clientY}px`);
    };

    resize();
    draw();
    if (!still) raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
    };
  }, []);

  return (
    <div
      ref={root}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
      style={{ ["--mx" as string]: "50%", ["--my" as string]: "40%" }}
    >
      <div className="absolute -left-40 -top-40 size-[34rem] rounded-full bg-accent/20 blur-[120px]" />
      <div className="absolute -bottom-48 -right-32 size-[30rem] rounded-full bg-squeeze/15 blur-[120px]" />
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(420px circle at var(--mx) var(--my), rgba(59,130,246,0.10), transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 30%, rgba(10,13,20,0.85) 100%)" }}
      />
    </div>
  );
}
