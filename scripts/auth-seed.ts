/**
 * DEV/TEST ONLY. Creates a user and a real database session and prints the Cookie header for it, so the protected
 * routes can be exercised without completing an OAuth login.   npm run auth:seed -- someone@example.com
 * Refuses to run against a production-looking URL unless ALLOW_SEED=1.
 */
import { serializeSignedCookie } from "better-call";
import { createAuth } from "@/lib/auth/server";
import { authStatus, baseUrl } from "@/lib/auth/providers";

async function main() {
  const st = authStatus(process.env);
  if (!st.enabled) { console.error(`Auth is not configured: ${st.reason}`); process.exit(1); }
  if (baseUrl(process.env).startsWith("https://") && process.env.ALLOW_SEED !== "1") { console.error("Refusing to seed a user against an https (production-looking) URL. Set ALLOW_SEED=1 to override."); process.exit(1); }
  const email = process.argv[2] ?? `seed-${Date.now()}@example.test`;
  const auth = createAuth(process.env);
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser({ name: "Seed User", email, emailVerified: true }, { method: "admin" });
  const session = await ctx.internalAdapter.createSession(user.id);
  const cookie = await serializeSignedCookie(ctx.authCookies.sessionToken.name, session.token, ctx.secret, {});
  console.log(cookie.split(";")[0]);   // name=value.signature, ready for `curl -H "Cookie: ..."`
  process.exit(0);
}
main().catch((e) => { console.error("Seed failed:", e instanceof Error ? e.message : e); process.exit(1); });
