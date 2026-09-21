import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { allowedOrigins, originAllowed, parseContact } from "@/lib/contact/validate";
import { authStatus } from "@/lib/auth/providers";
import { addContact } from "@/lib/feedback/store";

export const maxDuration = 15;

function cors(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");
  const h: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && allowedOrigins(process.env).includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "content-type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}
const reply = (req: NextRequest, body: object, status: number) => NextResponse.json(body, { status, headers: cors(req) });

/** The caller's address, hashed with a server secret so the database never holds a raw IP. Used only for rate limiting. */
function ipHash(req: NextRequest): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET ?? ""}|${ip}`).digest("hex").slice(0, 32);
}

// Browser preflight for the landing page's cross-origin POST.
export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: originAllowed(req.headers.get("origin"), process.env) ? 204 : 403, headers: cors(req) });
}

export async function POST(req: NextRequest) {
  // Messages live in the database that authentication uses, so the endpoint exists only where that is configured.
  if (!authStatus(process.env).enabled) return reply(req, { error: "Contact is not available on this deployment." }, 404);
  if (!originAllowed(req.headers.get("origin"), process.env)) return reply(req, { error: "forbidden" }, 403);
  if (Number(req.headers.get("content-length") ?? 0) > 16_000) return reply(req, { error: "That is too long." }, 413);
  const parsed = parseContact(await req.json().catch(() => null));
  if (!parsed.ok) return reply(req, { error: parsed.error }, 400);
  if ("spam" in parsed && parsed.spam) return reply(req, { ok: true }, 201); // honeypot: look successful, store nothing
  try {
    const stored = await addContact(parsed.value!, ipHash(req), req.headers.get("user-agent") ?? "");
    if (!stored) return reply(req, { error: "Too many messages right now. Please try again later." }, 429);
    return reply(req, { ok: true }, 201);
  } catch {
    return reply(req, { error: "Could not save that right now. Please try again." }, 500);
  }
}
