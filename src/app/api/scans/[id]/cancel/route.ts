import { NextResponse } from "next/server";
import { getScan } from "@/lib/db";
import { cancelScan } from "@/lib/scanner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const scan = getScan(id);
  if (!scan) return NextResponse.json({ ok: false, error: "Scan not found." }, { status: 404 });

  const cancelled = cancelScan(id);
  return NextResponse.json({ ok: true, cancelled });
}
