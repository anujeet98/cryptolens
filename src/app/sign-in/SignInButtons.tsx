"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";

interface Props { providers: { id: string; label: string }[]; next: string }

type Social = Parameters<typeof authClient.signIn.social>[0]["provider"];

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
          className="flex w-full items-center justify-center rounded-lg border border-line bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-white/[0.08] disabled:opacity-60">
          {busy === p.id ? "Redirecting…" : `Continue with ${p.label}`}
        </button>
      ))}
      {error && <p role="alert" className="pt-1 text-center text-xs text-bear">{error}</p>}
    </div>
  );
}
