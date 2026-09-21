import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/server";
import { authStatus, enabledProviders } from "@/lib/auth/providers";
import { MarketBackdrop } from "../sign-in/MarketBackdrop";
import { AccountPanel } from "./AccountPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account | CryptoLens", robots: { index: false, follow: false } };

export default async function AccountPage() {
  // Authentication is optional: with it off there is no account to manage.
  if (!authStatus(process.env).enabled) redirect("/");
  const session = await getAuth()
    ?.api.getSession({ headers: await headers() })
    .catch(() => null);
  if (!session) redirect("/sign-in?next=%2Faccount");
  const providers = enabledProviders(process.env).map(({ id, label }) => ({ id, label }));
  return (
    <main className="relative grid min-h-screen place-items-center px-4 py-10">
      <MarketBackdrop />
      <AccountPanel user={{ name: session.user.name, email: session.user.email }} providers={providers} />
    </main>
  );
}
