import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { gateDecision } from "@/lib/auth/gate";
import { authStatus, COOKIE_PREFIX } from "@/lib/auth/providers";

/**
 * Fast, optimistic gate: anonymous visitors are sent to /sign-in and anonymous API calls get a 401 before any page renders.
 * It only checks that a session cookie EXISTS, so it is a convenience, not the security boundary: every API route also
 * verifies the session for real (see lib/auth/guard.ts). Does nothing unless authentication is enabled.
 */
export function proxy(req: NextRequest) {
  const d = gateDecision({
    enabled: authStatus(process.env).enabled,
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
    hasSessionCookie: !!getSessionCookie(req, { cookiePrefix: COOKIE_PREFIX }),
    smokeToken: process.env.SMOKE_TOKEN,
    presentedToken: req.headers.get("x-smoke-token"),
  });
  if (d.action === "redirect") return NextResponse.redirect(new URL(d.to, req.url));
  if (d.action === "unauthorized")
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.next();
}

export const config = {
  // Everything except Next's static assets and image files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
