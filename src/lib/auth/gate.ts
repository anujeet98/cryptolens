import { timingSafeEqual } from "node:crypto";

/** Paths that never require a session: the sign-in page, the auth endpoints themselves, and the health check used by monitors and smoke tests. */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/sign-in" || pathname.startsWith("/sign-in/") || pathname.startsWith("/api/auth/") || pathname === "/api/auth" || pathname === "/api/health";
}

/**
 * Only same-site relative paths may be used as a post-sign-in destination. This blocks open-redirect tricks such as
 * "//evil.com", "https://evil.com", "/\\evil.com" and "javascript:" values, by construction rather than by blacklist.
 */
export function safeNext(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f]/.test(v)) return "/";
  if (v.startsWith("/sign-in") || v.startsWith("/api/auth")) return "/";
  return v;
}

export type GateDecision = { action: "allow" } | { action: "redirect"; to: string } | { action: "unauthorized" };

export interface GateInput {
  enabled: boolean; pathname: string; search?: string; hasSessionCookie: boolean;
  /** SMOKE_TOKEN configured on the server and the x-smoke-token header the caller sent. A match lets automated smoke tests through the proxy. */
  smokeToken?: string; presentedToken?: string | null;
}

/**
 * The FAST, optimistic gate run in proxy.ts. It looks only at whether a session cookie exists, so it is NOT security by
 * itself (a forged cookie passes). The real check is `checkApiAccess`, enforced inside every API route.
 */
export function gateDecision(i: GateInput): GateDecision {
  if (!i.enabled) return { action: "allow" };
  // The proxy runs before the route, so the smoke-test token must be honoured HERE too or anonymous API calls never reach it.
  if (i.smokeToken && tokensMatch(i.presentedToken, i.smokeToken)) return { action: "allow" };
  // NOTE: /sign-in is never bounced away from here. A cookie is not proof of a session (it may be expired, revoked or signed
  // with another secret), and bouncing on it creates a redirect loop with the dashboard's own guard. The sign-in PAGE checks
  // for a valid session on the server instead.
  if (isPublicPath(i.pathname)) return { action: "allow" };
  if (i.hasSessionCookie) return { action: "allow" };
  if (i.pathname.startsWith("/api/")) return { action: "unauthorized" };
  const next = safeNext(i.pathname + (i.search ?? ""));
  return { action: "redirect", to: next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}` };
}

/** Constant-time string comparison, so a token cannot be guessed by timing. Different lengths compare false without leaking where they differ. */
export function tokensMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface ApiAccessInput {
  enabled: boolean;
  /** The token configured on the server (SMOKE_TOKEN), if any. */
  smokeToken?: string;
  /** The token the caller presented in the x-smoke-token header. */
  presentedToken?: string | null;
  /** Resolves the real, validated session. Only called when needed. */
  getUser: () => Promise<{ id: string } | null>;
}

export type ApiAccess = { ok: true; via: "open" | "smoke-token" | "session"; userId?: string } | { ok: false; status: 401 };

/**
 * The STRICT check every API route runs. A valid session (looked up and verified, not just a cookie) or, for automated
 * smoke tests only, a matching server-side token. Anything else is refused. Off entirely when auth is not enabled.
 */
export async function checkApiAccess(i: ApiAccessInput): Promise<ApiAccess> {
  if (!i.enabled) return { ok: true, via: "open" };
  if (i.smokeToken && tokensMatch(i.presentedToken, i.smokeToken)) return { ok: true, via: "smoke-token" };
  try {
    const user = await i.getUser();
    if (user) return { ok: true, via: "session", userId: user.id };
  } catch { /* a failing session lookup must never open the door */ }
  return { ok: false, status: 401 };
}
