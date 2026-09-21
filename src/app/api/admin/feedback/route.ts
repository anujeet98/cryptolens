import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/guard";
import { authStatus } from "@/lib/auth/providers";
import { getAuth } from "@/lib/auth/server";
import { isAdmin, isStatus } from "@/lib/feedback/admin";
import { setInboxStatus } from "@/lib/feedback/store";

const json = (body: object, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function handle(req: NextRequest) {
  const auth = authStatus(process.env).enabled ? getAuth() : null;
  const session = auth ? await auth.api.getSession({ headers: req.headers }) : null;
  // 404, not 403: do not confirm that an admin API exists to anyone who is not on the list.
  if (!session || !isAdmin(session.user, process.env)) return json({ error: "not found" }, 404);
  const b = (await req.json().catch(() => null)) as { source?: unknown; id?: unknown; status?: unknown } | null;
  if (!b || !Number.isInteger(b.id) || !isStatus(b.status) || (b.source !== "feedback" && b.source !== "contact"))
    return json({ error: "invalid request" }, 400);
  return (await setInboxStatus(b.source, b.id as number, b.status))
    ? json({ ok: true }, 200)
    : json({ error: "not found" }, 404);
}

export const PATCH = withAuth(handle);
