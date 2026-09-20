"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { BRAND_PATHS } from "./brand-icons";

interface Props { providers: { id: string; label: string }[]; next: string }

type Social = Parameters<typeof authClient.signIn.social>[0]["provider"];

function Logo({ id }: { id: string }) {
  if (id === "microsoft") {
    return (
      <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
        <path fill="#f25022" d="M2 2h9.5v9.5H2z" /><path fill="#7fba00" d="M12.5 2H22v9.5h-9.5z" />
        <path fill="#00a4ef" d="M2 12.5h9.5V22H2z" /><path fill="#ffb900" d="M12.5 12.5H22V22h-9.5z" />
      </svg>
    );
  }
  const d = BRAND_PATHS[id];
  return d ? <svg viewBox="0 0 24 24" className="size-[18px] fill-current" aria-hidden><path d={d} /></svg> : <span className="size-[18px]" />;
}

export function SignInButtons({ providers, next }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (id: string) => {
    setBusy(id); setError(null);
    // Redirects the browser to the provider. If it fails before redirecting, surface it instead of a dead button.
    const res = await authClient.signIn.social({ provider: id as Social, callbackURL: next, errorCallbackURL: "/sign-in" });
    if (res?.error) { setError(res.error.message || "Could not start sign-in. Please try again."); setBusy(null); }
  };

  return (
    <div className="space-y-2.5">
      {providers.map((p) => (
        <button key={p.id} onClick={() => go(p.id)} disabled={busy !== null}
          className="group relative flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-foreground transition duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:bg-white/[0.09] hover:shadow-[0_8px_24px_-8px_rgba(59,130,246,0.55)] focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60 disabled:hover:translate-y-0">
          <Logo id={p.id} />
          <span className="flex-1 text-left">{busy === p.id ? "Redirecting…" : `Continue with ${p.label}`}</span>
          <span aria-hidden className="text-muted transition group-hover:translate-x-0.5 group-hover:text-foreground">→</span>
        </button>
      ))}
      {error && <p role="alert" className="pt-1 text-center text-xs text-bear">{error}</p>}
    </div>
  );
}
