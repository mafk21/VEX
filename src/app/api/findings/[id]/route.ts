import { NextRequest, NextResponse } from "next/server";
import { setFindingStatus, FINDING_STATUSES } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** Triage a finding: set its status (open / confirmed / false_positive / ignored). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const findingId = Number(id);
  if (!Number.isInteger(findingId)) {
    return NextResponse.json({ ok: false, error: "Invalid finding id." }, { status: 400 });
  }

  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const status = typeof body.status === "string" ? body.status : "";
  if (!(FINDING_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      { ok: false, error: `status must be one of: ${FINDING_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  const updated = setFindingStatus(findingId, status);
  if (!updated) return NextResponse.json({ ok: false, error: "Finding not found." }, { status: 404 });
  return NextResponse.json({ ok: true, finding: updated });
}
