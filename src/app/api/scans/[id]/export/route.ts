import { NextRequest, NextResponse } from "next/server";
import { getScan, getFindings } from "@/lib/db";
import { buildMarkdownReport } from "@/lib/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** Export a hunt report as a downloadable Markdown or JSON file. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const scan = getScan(id);
  if (!scan) return NextResponse.json({ ok: false, error: "Scan not found." }, { status: 404 });

  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "md";
  const findings = getFindings(id);
  const repoSlug = scan.repoFullName.replace(/[^a-z0-9]+/gi, "-");
  const date = new Date(scan.createdAt).toISOString().slice(0, 10);

  if (format === "json") {
    return new NextResponse(JSON.stringify({ scan, findings }, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="vex-report-${repoSlug}-${date}.json"`,
      },
    });
  }

  return new NextResponse(buildMarkdownReport(scan, findings), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="vex-report-${repoSlug}-${date}.md"`,
    },
  });
}
