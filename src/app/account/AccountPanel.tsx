"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { BRAND_PATHS } from "../sign-in/brand-icons";

interface Linked { id: string; providerId: string }
interface Props { user: { name: string; email: string }; providers: { id: string; label: string }[] }
type Social = Parameters<typeof authClient.signIn.social>[0]["provider"];

function Logo({ id }: { id: string }) {
  const d = BRAND_PATHS[id];
  return d ? <svg viewBox="0 0 24 24" className="size-[18px] shrink-0 fill-current" aria-hidden><path d={d} /></svg> : <span className="size-[18px] shrink-0" />;
}

export function AccountPanel({ user, providers }: Props) {
  const router = useRouter();
  const [linked, setLinked] = useState<Linked[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const label = (id: string) => providers.find((p) => p.id === id)?.label ?? id;

  const [tick, setTick] = useState(0);
  const reload = () => setTick((n) => n + 1);
  useEffect(() => {
    let live = true;
    void authClient.listAccounts().then((res) => {
      if (!live) return;
      if (res.error) setError("Could not load your linked accounts.");
      else setLinked((res.data ?? []).map((a) => ({ id: a.id, providerId: a.providerId })));
    });
    return () => { live = false; };
  }, [tick]);

  const link = async (id: string) => {
    setBusy(id); setError(null);
    const res = await authClient.linkSocial({ provider: id as Social, callbackURL: "/account" });
    if (res?.error) { setError(res.error.message || "Could not start linking."); setBusy(null); }
  };
  const unlink = async (l: Linked) => {
    setBusy(l.providerId); setError(null);
    const res = await authClient.unlinkAccount({ accountId: l.id });
    if (res.error) setError(res.error.message || "Could not unlink that account.");
    reload(); setBusy(null);
  };
  const remove = async () => {
    setBusy("delete"); setError(null);
    const res = await authClient.deleteUser();
    if (res.error) {
      setError(res.error.message || "Could not delete the account. If you signed in a while ago, sign out, sign in again and retry.");
      setBusy(null);
    } else { router.replace("/"); router.refresh(); }
  };

  const onlyOne = (linked?.length ?? 0) <= 1;
  const available = providers.filter((p) => !linked?.some((l) => l.providerId === p.id));

  return (
    <div className="w-full max-w-md space-y-4">
      <Link href="/" className="text-xs text-muted transition hover:text-foreground">← Back to dashboard</Link>
      <div className="rounded-2xl border border-white/10 bg-panel/70 p-7 shadow-2xl backdrop-blur-xl">
        <h1 className="text-xl font-semibold">Account</h1>
        <p className="mt-1 text-sm text-muted">{user.name} · {user.email}</p>

        <h2 className="mt-7 text-xs font-semibold uppercase tracking-wide text-muted">Sign-in methods</h2>
        <ul className="mt-3 space-y-2">
          {linked === null && <li className="text-sm text-muted">Loading…</li>}
          {linked?.map((l) => (
            <li key={l.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm">
              <Logo id={l.providerId} /><span className="flex-1">{label(l.providerId)}</span>
              <button onClick={() => unlink(l)} disabled={onlyOne || busy !== null} title={onlyOne ? "You need at least one sign-in method" : undefined}
                className="text-xs text-muted transition hover:text-bear disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted">Unlink</button>
            </li>
          ))}
        </ul>

        {available.length > 0 && linked !== null && (
          <>
            <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">Add another</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {available.map((p) => (
                <button key={p.id} onClick={() => link(p.id)} disabled={busy !== null}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs transition hover:border-accent/50 hover:bg-white/[0.09] disabled:opacity-60">
                  <Logo id={p.id} />{busy === p.id ? "Redirecting…" : p.label}
                </button>
              ))}
            </div>
          </>
        )}

        {error && <p role="alert" className="mt-5 rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear">{error}</p>}

        <div className="mt-8 rounded-xl border border-bear/30 bg-bear/[0.06] p-4">
          <h2 className="text-sm font-semibold text-bear">Delete account</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">Permanently removes your profile, linked sign-in methods and sessions. This cannot be undone. Type <span className="font-mono text-foreground">DELETE</span> to confirm.</p>
          <div className="mt-3 flex gap-2">
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs outline-none focus:border-bear/60" />
            <button onClick={remove} disabled={confirm !== "DELETE" || busy !== null}
              className="rounded-lg bg-bear px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{busy === "delete" ? "Deleting…" : "Delete"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
