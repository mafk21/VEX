import { NextResponse } from "next/server";
import { getScan, getFindingCounts, getFindings } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** Scan status + progress + severity counts. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const scan = getScan(id);
  if (!scan) return NextResponse.json({ ok: false, error: "Scan not found." }, { status: 404 });

  return NextResponse.json({
    ok: true,
    scan,
    findings: getFindingCounts(id),
    total: getFindings(id).length,
  });
}
