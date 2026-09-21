"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { LIMITS, type FeedbackKind } from "@/lib/feedback/validate";

const TABS: { kind: FeedbackKind; label: string; title: string; hint: string; body: string }[] = [
  {
    kind: "feature",
    label: "Idea",
    title: "Suggest a feature",
    hint: "What should CryptoLens do that it doesn't?",
    body: "Describe the idea and what it would help you do.",
  },
  {
    kind: "bug",
    label: "Bug",
    title: "Report a problem",
    hint: "What went wrong?",
    body: "What did you expect, and what happened instead? Steps help.",
  },
  {
    kind: "message",
    label: "Message",
    title: "Message the developer",
    hint: "",
    body: "Questions, feedback, anything on your mind.",
  },
];

/** Header button plus a modal (native <dialog>: focus is trapped, Esc closes, backdrop click closes). Shown only to signed-in users. */
export function FeedbackButton() {
  const { enabled, user } = useAuth();
  const ref = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<FeedbackKind>("feature");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const tab = TABS.find((t) => t.kind === kind)!;

  // Reset once the dialog has closed (also on Esc), so the next open starts clean, and a sent message is not shown twice.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onClose = () => {
      setState("idle");
      setError(null);
      setTitle("");
      setBody("");
    };
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, [enabled, user]);

  if (!enabled || !user) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, title, body, page: window.location.pathname }),
      });
      if (res.ok) {
        setState("sent");
        return;
      }
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(
        j?.error && j.error !== "unauthorized"
          ? j.error
          : res.status === 401
            ? "Your session expired. Please sign in again."
            : "Something went wrong. Please try again.",
      );
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    setState("idle");
  };

  const field =
    "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent/60";

  return (
    <>
      <button
        onClick={() => ref.current?.showModal()}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted transition hover:text-foreground"
        title="Send feedback"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4 fill-none stroke-current"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
        </svg>
        <span className="hidden sm:inline">Feedback</span>
      </button>
      <dialog
        ref={ref}
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
        aria-labelledby="fb-title"
        className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-white/10 bg-panel p-0 text-foreground shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        {state === "sent" ? (
          <div className="p-8 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-bull/15 text-bull" aria-hidden>
              <svg
                viewBox="0 0 24 24"
                className="size-6 fill-none stroke-current"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 12 4.5 4.5L19 7" />
              </svg>
            </div>
            <h2 id="fb-title" className="mt-4 text-lg font-semibold">
              Thank you
            </h2>
            <p className="mt-1.5 text-sm text-muted">It reached the developer. Every message gets read.</p>
            <button
              onClick={() => ref.current?.close()}
              className="mt-6 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="fb-title" className="text-lg font-semibold">
                  {tab.title}
                </h2>
                <p className="mt-0.5 text-xs text-muted">{tab.hint || "Goes straight to the developer."}</p>
              </div>
              <button
                type="button"
                onClick={() => ref.current?.close()}
                className="rounded p-1 text-muted transition hover:text-foreground"
                aria-label="Close"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-5 fill-none stroke-current"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div
              role="tablist"
              aria-label="Type of feedback"
              className="mt-5 grid grid-cols-3 gap-1 rounded-lg bg-black/30 p-1"
            >
              {TABS.map((t) => (
                <button
                  key={t.kind}
                  type="button"
                  role="tab"
                  aria-selected={kind === t.kind}
                  onClick={() => {
                    setKind(t.kind);
                    setError(null);
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${kind === t.kind ? "bg-accent/20 text-accent" : "text-muted hover:text-foreground"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {kind !== "message" && (
              <label className="mt-4 block text-xs font-medium text-muted">
                Title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={LIMITS.titleMax}
                  required
                  placeholder={kind === "bug" ? "e.g. Chart freezes when I switch to 4H" : "e.g. Telegram alerts"}
                  className={`${field} mt-1.5`}
                />
              </label>
            )}
            <label className="mt-4 block text-xs font-medium text-muted">
              {kind === "message" ? "Message" : "Details"}
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={LIMITS.bodyMax}
                required
                minLength={LIMITS.bodyMin}
                rows={6}
                placeholder={tab.body}
                className={`${field} mt-1.5 resize-y`}
              />
            </label>
            <div className="mt-1 text-right text-[11px] tabular-nums text-muted">
              {body.length}/{LIMITS.bodyMax}
            </div>
            {error && (
              <p role="alert" className="mt-2 rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear">
                {error}
              </p>
            )}
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[11px] leading-snug text-muted">
                Sent with your account ({user.email}) so the developer can reply.
              </p>
              <button
                disabled={state === "sending"}
                className="shrink-0 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {state === "sending" ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
