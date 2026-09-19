import { NextResponse } from "next/server";

export function fail(e: unknown, status = 502) {
  return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status });
}

export const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;
