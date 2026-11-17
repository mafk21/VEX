import { NextResponse } from "next/server";
import { getStatus } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Connection status — never exposes key material. */
export function GET() {
  return NextResponse.json(getStatus());
}
