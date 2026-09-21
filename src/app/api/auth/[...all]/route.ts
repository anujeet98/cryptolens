import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/server";

export const maxDuration = 15;

const off = () => NextResponse.json({ error: "authentication is not enabled" }, { status: 404 });

export async function GET(req: Request) {
  const a = getAuth();
  return a ? toNextJsHandler(a).GET(req) : off();
}
export async function POST(req: Request) {
  const a = getAuth();
  return a ? toNextJsHandler(a).POST(req) : off();
}
