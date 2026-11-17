import { NextRequest, NextResponse } from "next/server";
import { isReady, getGitHubToken } from "@/lib/config";
import { getActiveScanForRepo, getCachedRepo, listScans, getFindingCounts } from "@/lib/db";
import { startScan } from "@/lib/scanner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Create a scan for a repo. */
export async function POST(req: NextRequest) {
  if (!isReady()) {
    return NextResponse.json({ ok: false, error: "Connect GitHub and Gemini first." }, { status: 401 });
  }
  let body: { repoFullName?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const repoFullName = typeof body.repoFullName === "string" ? body.repoFullName : "";
  if (!repoFullName) {
    return NextResponse.json({ ok: false, error: "Missing repoFullName." }, { status: 400 });
  }

  const repo = getCachedRepo(repoFullName);
  if (!repo) {
    return NextResponse.json({ ok: false, error: "Unknown repository — refresh the repo list first." }, { status: 404 });
  }
  if (!getGitHubToken()) {
    return NextResponse.json({ ok: false, error: "GitHub is not connected." }, { status: 401 });
  }

  const active = getActiveScanForRepo(repoFullName);
  if (active) {
    return NextResponse.json({ ok: false, error: "A scan is already running for this repo.", scanId: active.id }, { status: 409 });
  }

  const result = await startScan(repoFullName);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, scanId: result.scanId });
}

/** Scan history (all repos). */
export function GET() {
  const scans = listScans().map((s) => ({
    ...s,
    findings: getFindingCounts(s.id),
  }));
  return NextResponse.json({ ok: true, scans });
}
