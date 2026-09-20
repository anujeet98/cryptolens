"use client";
import Link from "next/link";
import { useAuth } from "./AuthProvider";

/** Signed-in identity and sign-out. Renders nothing when authentication is off (self-hosted copies) or nobody is signed in. */
export function UserMenu() {
  const { enabled, user, signOut } = useAuth();
  if (!enabled || !user) return null;
  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-2 text-xs">
      <Link href="/account" className="flex items-center gap-2 rounded px-1 py-0.5 text-muted hover:text-foreground" title="Account settings">
        <span className="grid size-6 place-items-center rounded-full bg-accent/20 font-semibold text-accent" aria-hidden>{initial}</span>
        <span className="hidden max-w-[10rem] truncate sm:inline" title={user.email}>{user.name || user.email}</span>
      </Link>
      <button onClick={() => void signOut()} className="rounded px-2 py-1 text-muted hover:text-foreground">Sign out</button>
    </div>
  );
}
