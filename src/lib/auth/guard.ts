import { NextResponse, type NextRequest } from "next/server";
import { checkApiAccess } from "./gate";
import { authStatus } from "./providers";
import { getAuth } from "./server";

/**
 * The strict per-route check. Returns a 401 response to send back, or null when the request may proceed.
 * The proxy's cookie check is only a fast path; this is the one that actually verifies the session.
 */
export async function requireAccess(req: Request): Promise<Response | null> {
  const enabled = authStatus(process.env).enabled;
  const access = await checkApiAccess({
    enabled,
    smokeToken: process.env.SMOKE_TOKEN,
    presentedToken: req.headers.get("x-smoke-token"),
    getUser: async () => {
      const auth = getAuth();
      const s = auth ? await auth.api.getSession({ headers: req.headers }) : null;
      return s?.user ?? null;
    },
  });
  if (access.ok) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

type Handler = (req: NextRequest) => Promise<Response> | Response;

/** Wrap an API route handler so it is refused (401) unless the caller is signed in, or auth is off. */
export function withAuth(handler: Handler): (req: NextRequest) => Promise<Response> {
  return async (req) => (await requireAccess(req)) ?? handler(req);
}
