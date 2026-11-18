import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { vexDir } from "@/lib/vexdir";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Nuclear privacy control: delete ALL local VEX data — keys (config.json)
 * and every database row (repos cache, scans, chunks, files, findings).
 * Rows are deleted rather than the db file so the open handle stays valid.
 */
export function DELETE() {
  try {
    const db = getDb();
    db.exec("DELETE FROM findings; DELETE FROM scan_chunks; DELETE FROM scan_files; DELETE FROM scans; DELETE FROM repos;");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    /* db may not be initialized — nothing to delete */
  }
  try {
    fs.unlinkSync(path.join(vexDir(), "config.json"));
  } catch {
    /* already gone */
  }
  return NextResponse.json({ ok: true });
}
