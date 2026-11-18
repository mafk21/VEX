import { NextResponse } from "next/server";
import { getScan, getFindingCounts, getFindings, getRunningChunk } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
};

/** Scan status + progress + severity counts + which files are being scanned right now. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const scan = getScan(id);
  if (!scan) return NextResponse.json({ ok: false, error: "Scan not found." }, { status: 404 });

  const running = getRunningChunk(id);

  return NextResponse.json({
    ok: true,
    scan,
    findings: getFindingCounts(id),
    total: getFindings(id).length,
    currentChunk: running ? { idx: running.idx, files: running.files.map((f) => f.split("|")[0]) } : null,
    serverNow: new Date().toISOString(),
  });
}
