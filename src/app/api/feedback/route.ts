import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/guard";
import { authStatus } from "@/lib/auth/providers";
import { getAuth } from "@/lib/auth/server";
import { addFeedback } from "@/lib/feedback/store";
import { parseFeedback } from "@/lib/feedback/validate";

export const maxDuration = 15;
const json = (body: object, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function handle(req: NextRequest) {
  // Feedback belongs to an account, so it exists only where sign-in is on (a self-hosted open copy has nowhere to store it).
  const auth = authStatus(process.env).enabled ? getAuth() : null;
  if (!auth) return json({ error: "Feedback is not available on this deployment." }, 404);
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return json({ error: "unauthorized" }, 401);
  if (Number(req.headers.get("content-length") ?? 0) > 16_000) return json({ error: "That is too long." }, 413);
  const parsed = parseFeedback(await req.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  try {
    const stored = await addFeedback(session.user.id, parsed.value, req.headers.get("user-agent") ?? "");
    if (!stored) return json({ error: "You have sent a lot in the last hour. Please try again later." }, 429);
    return json({ ok: true }, 201);
  } catch {
    return json({ error: "Could not save that right now. Please try again." }, 500);
  }
}

export const POST = withAuth(handle);
