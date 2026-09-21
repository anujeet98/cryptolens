"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CoinListing } from "@/types/market";

export function SymbolSearch({ value, onSelect }: { value: string; onSelect: (base: string) => void }) {
  const [coins, setCoins] = useState<CoinListing[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/symbols")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setCoins(d))
      .catch(() => {});
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const results = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return coins.filter((c) => ["BTC", "ETH", "SOL", "BNB", "XRP", "NEAR", "DOGE"].includes(c.base));
    return coins
      .filter((c) => c.base.includes(s))
      .sort(
        (a, b) =>
          Number(b.base === s) - Number(a.base === s) ||
          Number(b.base.startsWith(s)) - Number(a.base.startsWith(s)) ||
          a.base.length - b.base.length,
      )
      .slice(0, 12);
  }, [coins, q]);

  return (
    <div ref={ref} className="relative w-64">
      <input
        value={open ? q : value}
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search coin… (BTC, NEAR)"
        className="w-full rounded border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent"
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded border border-line bg-panel shadow-xl">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">No match</li>}
          {results.map((c) => (
            <li key={c.base}>
              <button
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-white/5"
                onClick={() => {
                  onSelect(c.base);
                  setOpen(false);
                }}
              >
                <span className="font-medium">{c.base}</span>
                <span className="text-xs text-muted">{[...new Set(c.markets.map((m) => m.exchange))].join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
