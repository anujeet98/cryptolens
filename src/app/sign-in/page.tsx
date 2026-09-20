import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/server";
import { safeNext } from "@/lib/auth/gate";
import { authStatus, enabledProviders } from "@/lib/auth/providers";
import { SignInButtons } from "./SignInButtons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in | CryptoLens", robots: { index: false, follow: false } };

const MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  account_not_linked: "That email is already registered with a different sign-in method. Use the method you signed up with.",
};

export default async function SignInPage(props: PageProps<"/sign-in">) {
  // Authentication is optional: with it off there is nothing to sign in to.
  if (!authStatus(process.env).enabled) redirect("/");
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNext(one(sp.next));
  const err = one(sp.error);
  // Already signed in with a VALID session (verified, not just a cookie): go where they were headed. A stale or forged
  // cookie fails this check and simply sees the sign-in page, which is what breaks any redirect loop.
  const session = await getAuth()?.api.getSession({ headers: await headers() }).catch(() => null);
  if (session) redirect(next);
  const providers = enabledProviders(process.env).map(({ id, label }) => ({ id, label }));

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-7 shadow-2xl">
        <div className="text-center">
          <div className="text-sm font-semibold tracking-wide">CRYPTO<span className="text-accent">LENS</span></div>
          <h1 className="mt-4 text-xl font-semibold">Sign in to continue</h1>
          <p className="mt-1.5 text-sm text-muted">No password to remember. Use an account you already have.</p>
        </div>
        {err && <p role="alert" className="mt-5 rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-center text-xs text-bear">{MESSAGES[err] ?? "Sign-in failed. Please try again."}</p>}
        <div className="mt-6"><SignInButtons providers={providers} next={next} /></div>
        <p className="mt-6 text-center text-[11px] leading-snug text-muted">CryptoLens shows market data and statistical estimates. It is not financial advice.</p>
      </div>
    </main>
  );
}
