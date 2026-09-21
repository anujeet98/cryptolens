import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/server";
import { safeNext } from "@/lib/auth/gate";
import { authStatus, enabledProviders } from "@/lib/auth/providers";
import { resolveHomeUrl } from "@/lib/home";
import { MarketBackdrop } from "./MarketBackdrop";
import { SignInButtons } from "./SignInButtons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in | CryptoLens", robots: { index: false, follow: false } };

const MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  account_not_linked:
    "That email is already registered with a different sign-in method. Use the method you signed up with.",
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
  const session = await getAuth()
    ?.api.getSession({ headers: await headers() })
    .catch(() => null);
  if (session) redirect(next);
  const providers = enabledProviders(process.env).map(({ id, label }) => ({ id, label }));

  const home = resolveHomeUrl(process.env.NEXT_PUBLIC_HOME_URL);

  return (
    <main className="relative grid min-h-screen place-items-center px-4 py-10">
      <MarketBackdrop />
      {home && (
        <a href={home} className="absolute left-5 top-5 text-xs text-muted transition hover:text-foreground">
          ← Back to home
        </a>
      )}
      <div className="grid w-full max-w-4xl items-center gap-10 md:grid-cols-[1.1fr_1fr]">
        <section className="hidden md:block">
          <div className="text-sm font-semibold tracking-wide">
            CRYPTO<span className="text-accent">LENS</span>
          </div>
          <h2 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight">
            See the market&apos;s{" "}
            <span className="bg-gradient-to-r from-accent to-squeeze bg-clip-text text-transparent">real state</span>,
            not the noise.
          </h2>
          <ul className="mt-6 space-y-3 text-sm text-muted">
            {[
              "Live regime, volatility and risk ranges",
              "Order flow, liquidations, funding and open interest",
              "Cross-exchange view across Binance, Bybit and Bitget",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-bull shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                {t}
              </li>
            ))}
          </ul>
        </section>
        <div className="w-full max-w-sm justify-self-center rounded-2xl border border-white/10 bg-panel/70 p-7 shadow-2xl backdrop-blur-xl">
          <div className="text-center">
            <div className="text-sm font-semibold tracking-wide md:hidden">
              CRYPTO<span className="text-accent">LENS</span>
            </div>
            <h1 className="mt-4 text-xl font-semibold md:mt-0">Sign in to continue</h1>
            <p className="mt-1.5 text-sm text-muted">No password to remember. Use an account you already have.</p>
          </div>
          {err && (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-center text-xs text-bear"
            >
              {MESSAGES[err] ?? "Sign-in failed. Please try again."}
            </p>
          )}
          <div className="mt-6">
            <SignInButtons providers={providers} next={next} />
          </div>
          <p className="mt-6 text-center text-[11px] leading-snug text-muted">
            CryptoLens shows market data and statistical estimates. It is not financial advice.
          </p>
        </div>
      </div>
    </main>
  );
}
