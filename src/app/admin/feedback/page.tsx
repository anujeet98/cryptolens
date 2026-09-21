import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAuth } from "@/lib/auth/server";
import { authStatus } from "@/lib/auth/providers";
import { isAdmin } from "@/lib/feedback/admin";
import { listInbox } from "@/lib/feedback/store";
import { AdminFeedback } from "./AdminFeedback";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feedback inbox | CryptoLens", robots: { index: false, follow: false } };

export default async function AdminFeedbackPage() {
  // Anyone who is not an admin sees an ordinary 404, so the page's existence is not revealed.
  const auth = authStatus(process.env).enabled ? getAuth() : null;
  const session = await auth?.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session || !isAdmin(session.user, process.env)) notFound();
  const items = await listInbox();
  return <AdminFeedback initial={items} />;
}
