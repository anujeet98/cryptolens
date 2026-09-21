"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { STATUSES, type FeedbackStatus } from "@/lib/feedback/admin";
import type { FeedbackRow } from "@/lib/feedback/store";

const KIND = { feature: { label: "Idea", cls: "bg-accent/15 text-accent" }, bug: { label: "Bug", cls: "bg-bear/15 text-bear" }, message: { label: "Message", cls: "bg-squeeze/15 text-squeeze" } } as const;
const STATUS_CLS: Record<string, string> = { new: "text-warn", seen: "text-muted", planned: "text-accent", done: "text-bull", dismissed: "text-muted/60" };

export function AdminFeedback({ initial }: { initial: FeedbackRow[] }) {
  const [items, setItems] = useState(initial);
  const [kind, setKind] = useState<"all" | keyof typeof KIND>("all");
  const [status, setStatus] = useState<"all" | FeedbackStatus>("all");
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => items.filter((i) => (kind === "all" || i.kind === kind) && (status === "all" || i.status === status)), [items, kind, status]);
  const count = (k: string) => items.filter((i) => k === "all" || i.kind === k).length;
  const fresh = items.filter((i) => i.status === "new").length;

  const setItemStatus = async (id: number, next: FeedbackStatus) => {
    setError(null);
    const res = await fetch("/api/admin/feedback", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status: next }) });
    if (res.ok) setItems((all) => all.map((i) => (i.id === id ? { ...i, status: next } : i)));
    else setError("Could not update that item.");
  };

  const chip = (active: boolean) => `rounded-md px-3 py-1.5 text-xs font-medium transition ${active ? "bg-accent/20 text-accent" : "text-muted hover:text-foreground"}`;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <div><h1 className="text-xl font-semibold">Feedback inbox</h1><p className="mt-0.5 text-xs text-muted">{items.length} total · {fresh} new · internal, visible only to admins</p></div>
        <Link href="/" className="text-xs text-muted transition hover:text-foreground">← Dashboard</Link>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-panel p-1">
          {(["all", "feature", "bug", "message"] as const).map((k) => <button key={k} onClick={() => setKind(k)} className={chip(kind === k)}>{k === "all" ? "All" : KIND[k].label} <span className="tabular-nums opacity-60">{count(k)}</span></button>)}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter by status" className="rounded-lg border border-white/10 bg-panel px-3 py-2 text-xs outline-none focus:border-accent/60">
          <option value="all">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear">{error}</p>}
      <ul className="mt-5 space-y-3">
        {shown.length === 0 && <li className="rounded-xl border border-line bg-panel p-8 text-center text-sm text-muted">Nothing here yet.</li>}
        {shown.map((i) => (
          <li key={i.id} className={`rounded-xl border bg-panel p-5 ${i.status === "new" ? "border-warn/30" : "border-line"}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded px-2 py-0.5 font-semibold ${KIND[i.kind].cls}`}>{KIND[i.kind].label}</span>
              <span className={`font-medium ${STATUS_CLS[i.status] ?? "text-muted"}`}>{i.status}</span>
              <span className="ml-auto text-muted tabular-nums">{i.createdAt.slice(0, 16).replace("T", " ")} UTC</span>
            </div>
            {i.title && <h2 className="mt-2 text-base font-semibold">{i.title}</h2>}
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{i.body}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-muted">
              <a href={`mailto:${i.email}?subject=${encodeURIComponent(i.title ? `Re: ${i.title}` : "Re: your CryptoLens message")}`} className="text-accent hover:underline">{i.name} · {i.email}</a>
              {i.page && <span>on <span className="font-mono">{i.page}</span></span>}
              <div className="ml-auto flex gap-1">
                {STATUSES.filter((s) => s !== i.status).map((s) => <button key={s} onClick={() => setItemStatus(i.id, s)} className="rounded px-2 py-1 transition hover:bg-white/[0.06] hover:text-foreground">{s}</button>)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
