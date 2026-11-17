import { NextResponse } from "next/server";
import { getScan, getFindings } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** Full findings list for a scan, most severe first. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const scan = getScan(id);
  if (!scan) return NextResponse.json({ ok: false, error: "Scan not found." }, { status: 404 });

  return NextResponse.json({ ok: true, findings: getFindings(id) });
}
