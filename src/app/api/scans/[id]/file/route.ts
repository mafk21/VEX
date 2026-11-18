import { NextRequest, NextResponse } from "next/server";
import { getScan, getScanFile } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** Serve a file's source captured during the scan (powers the code viewer). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const scan = getScan(id);
  if (!scan) return NextResponse.json({ ok: false, error: "Scan not found." }, { status: 404 });

  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!path) return NextResponse.json({ ok: false, error: "Missing path." }, { status: 400 });

  const file = getScanFile(id, path);
  if (!file) {
    return NextResponse.json({ ok: false, error: "This file's source wasn't captured for the scan." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, file });
}
