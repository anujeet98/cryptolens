"use client";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { authClient } from "@/lib/auth/client";
import { resolveHomeUrl } from "@/lib/home";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}
interface AuthState {
  enabled: boolean;
  pending: boolean;
  user: AuthUser | null;
  signOut: () => Promise<void>;
}

const OFF: AuthState = { enabled: false, pending: false, user: null, signOut: async () => {} };
const Ctx = createContext<AuthState>(OFF);
export const useAuth = () => useContext(Ctx);

/** Set while a deliberate sign-out is navigating away, so the auth guard does not race it with its own redirect to /sign-in. */
let signingOut = false;

function Enabled({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, isPending } = authClient.useSession();
  const user = data?.user ? { id: data.user.id, name: data.user.name, email: data.user.email } : null;
  const value = useMemo<AuthState>(
    () => ({
      enabled: true,
      pending: isPending,
      user,
      signOut: async () => {
        signingOut = true;
        await authClient.signOut();
        // With a landing page configured, sign-out goes there (a full navigation: it is another site); otherwise to the sign-in screen.
        const home = resolveHomeUrl(process.env.NEXT_PUBLIC_HOME_URL);
        if (home) {
          window.location.assign(home);
          return;
        }
        router.replace("/sign-in");
        router.refresh();
        signingOut = false;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `user` is derived from data?.user, tracked through its id
    [isPending, data?.user?.id, data?.user?.name, data?.user?.email, router],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `enabled` comes from the server (it depends on the environment). When off, everything below behaves as before: no session, no redirects. */
export function AuthProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return enabled ? <Enabled>{children}</Enabled> : <Ctx.Provider value={OFF}>{children}</Ctx.Provider>;
}

/**
 * Third layer of protection: if the session turns out to be missing or invalid (the proxy only saw a cookie, and the API
 * routes would already be answering 401), send the person to sign in instead of leaving an empty dashboard.
 */
export function useAuthGuard() {
  const { enabled, pending, user } = useAuth();
  useEffect(() => {
    if (enabled && !pending && !user && !signingOut) {
      const here = window.location.pathname + window.location.search;
      window.location.replace(here === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(here)}`);
    }
  }, [enabled, pending, user]);
  return { enabled, ready: !enabled || (!pending && !!user) };
}
