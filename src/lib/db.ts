import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { vexDir } from "./vexdir";
import type { RepoSummary } from "./github";

/**
 * Local SQLite database at .vex/vex.db using Node's built-in SQLite.
 * No native modules, no external services.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS repos (
  id             INTEGER PRIMARY KEY,
  full_name      TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT,
  language       TEXT,
  private        INTEGER NOT NULL DEFAULT 0,
  default_branch TEXT NOT NULL DEFAULT 'main',
  updated_at     TEXT,
  html_url       TEXT,
  cached_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id            TEXT PRIMARY KEY,
  repo_full_name TEXT NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'quick',
  status        TEXT NOT NULL DEFAULT 'queued',
  model         TEXT,
  total_chunks  INTEGER NOT NULL DEFAULT 0,
  done_chunks   INTEGER NOT NULL DEFAULT 0,
  coverage      TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL,
  finished_at   TEXT
);

CREATE TABLE IF NOT EXISTS scan_chunks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id    TEXT NOT NULL REFERENCES scans(id),
  idx        INTEGER NOT NULL,
  files      TEXT NOT NULL,
  est_tokens INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'pending',
  error      TEXT
);

CREATE TABLE IF NOT EXISTS scan_files (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id  TEXT NOT NULL REFERENCES scans(id),
  path     TEXT NOT NULL,
  content  TEXT NOT NULL,
  lines    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(scan_id, path)
);

CREATE TABLE IF NOT EXISTS findings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id       TEXT NOT NULL REFERENCES scans(id),
  file_path     TEXT NOT NULL,
  line_start    INTEGER,
  line_end      INTEGER,
  severity      TEXT NOT NULL,
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  explanation   TEXT NOT NULL,
  suggested_fix TEXT,
  confidence    REAL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_findings_scan ON findings(scan_id);
CREATE INDEX IF NOT EXISTS idx_chunks_scan ON scan_chunks(scan_id);
CREATE INDEX IF NOT EXISTS idx_files_scan ON scan_files(scan_id);
`;

const g = globalThis as unknown as { __vexDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (!g.__vexDb) {
    const db = new DatabaseSync(path.join(vexDir(), "vex.db"));
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA);
    g.__vexDb = db;
  }
  return g.__vexDb;
}

/* ── repos cache ─────────────────────────────────────────────────────────── */

export function cacheRepos(repos: RepoSummary[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO repos (id, full_name, name, description, language, private, default_branch, updated_at, html_url, cached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      full_name = excluded.full_name, name = excluded.name, description = excluded.description,
      language = excluded.language, private = excluded.private, default_branch = excluded.default_branch,
      updated_at = excluded.updated_at, html_url = excluded.html_url, cached_at = excluded.cached_at
  `);
  const seenIds = new Set((db.prepare("SELECT id FROM repos").all() as Array<{ id: number }>).map((r) => r.id));
  for (const r of repos) {
    upsert.run(r.id, r.fullName, r.name, r.description, r.language, r.private ? 1 : 0, r.defaultBranch, r.updatedAt, r.htmlUrl, now);
    seenIds.delete(r.id);
  }
  const del = db.prepare("DELETE FROM repos WHERE id = ?");
  for (const stale of seenIds) del.run(stale);
}

export function getCachedRepos(): RepoSummary[] {
  const rows = getDb().prepare("SELECT * FROM repos ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    fullName: r.full_name as string,
    description: (r.description as string) ?? null,
    language: (r.language as string) ?? null,
    private: !!r.private,
    defaultBranch: r.default_branch as string,
    updatedAt: (r.updated_at as string) ?? "",
    htmlUrl: (r.html_url as string) ?? "",
  }));
}

export function getCachedRepo(fullName: string): RepoSummary | null {
  const r = getDb().prepare("SELECT * FROM repos WHERE full_name = ?").get(fullName) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: r.id as number,
    name: r.name as string,
    fullName: r.full_name as string,
    description: (r.description as string) ?? null,
    language: (r.language as string) ?? null,
    private: !!r.private,
    defaultBranch: r.default_branch as string,
    updatedAt: (r.updated_at as string) ?? "",
    htmlUrl: (r.html_url as string) ?? "",
  };
}

export function clearCachedRepos(): void {
  getDb().exec("DELETE FROM repos");
}

/* ── scans ───────────────────────────────────────────────────────────────── */

export interface Coverage {
  files_total: number;
  files_selected: number;
  files_scanned: number;
  files_skipped: number;
  files_oversized: number;
  est_tokens: number;
  tree_truncated: boolean;
}

export interface ScanRecord {
  id: string;
  repoFullName: string;
  mode: string;
  status: string;
  model: string | null;
  totalChunks: number;
  doneChunks: number;
  coverage: Coverage | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

function rowToScan(r: Record<string, unknown>): ScanRecord {
  return {
    id: r.id as string,
    repoFullName: r.repo_full_name as string,
    mode: r.mode as string,
    status: r.status as string,
    model: (r.model as string) ?? null,
    totalChunks: r.total_chunks as number,
    doneChunks: r.done_chunks as number,
    coverage: r.coverage ? JSON.parse(r.coverage as string) : null,
    error: (r.error as string) ?? null,
    createdAt: r.created_at as string,
    finishedAt: (r.finished_at as string) ?? null,
  };
}

export function createScan(id: string, repoFullName: string, mode: string, model: string | null): void {
  getDb()
    .prepare("INSERT INTO scans (id, repo_full_name, mode, status, model, created_at) VALUES (?, ?, ?, 'queued', ?, ?)")
    .run(id, repoFullName, mode, model, new Date().toISOString());
}

export function updateScan(
  id: string,
  patch: Partial<{ status: string; totalChunks: number; doneChunks: number; coverage: Coverage; error: string | null; finishedAt: string }>,
): void {
  const sets: string[] = [];
  const vals: Array<string | number | null> = [];
  if (patch.status !== undefined) { sets.push("status = ?"); vals.push(patch.status); }
  if (patch.totalChunks !== undefined) { sets.push("total_chunks = ?"); vals.push(patch.totalChunks); }
  if (patch.doneChunks !== undefined) { sets.push("done_chunks = ?"); vals.push(patch.doneChunks); }
  if (patch.coverage !== undefined) { sets.push("coverage = ?"); vals.push(JSON.stringify(patch.coverage)); }
  if (patch.error !== undefined) { sets.push("error = ?"); vals.push(patch.error); }
  if (patch.finishedAt !== undefined) { sets.push("finished_at = ?"); vals.push(patch.finishedAt); }
  if (sets.length === 0) return;
  vals.push(id);
  getDb().prepare(`UPDATE scans SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function getScan(id: string): ScanRecord | null {
  const r = getDb().prepare("SELECT * FROM scans WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? rowToScan(r) : null;
}

export function listScans(limit = 50): ScanRecord[] {
  const rows = getDb().prepare("SELECT * FROM scans ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToScan);
}

export function getActiveScanForRepo(repoFullName: string): ScanRecord | null {
  const r = getDb()
    .prepare("SELECT * FROM scans WHERE repo_full_name = ? AND status IN ('queued','fetching','scanning') ORDER BY created_at DESC LIMIT 1")
    .get(repoFullName) as Record<string, unknown> | undefined;
  return r ? rowToScan(r) : null;
}

export function getResumableScans(): ScanRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM scans WHERE status IN ('queued','fetching','scanning')")
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToScan);
}

/* ── chunks ──────────────────────────────────────────────────────────────── */

export interface ChunkRow {
  id: number;
  scanId: string;
  idx: number;
  files: string[];
  estTokens: number;
  status: string;
  error: string | null;
}

export function insertChunks(scanId: string, chunks: Array<{ idx: number; files: string[]; estTokens: number }>): void {
  const stmt = getDb().prepare("INSERT INTO scan_chunks (scan_id, idx, files, est_tokens) VALUES (?, ?, ?, ?)");
  for (const c of chunks) stmt.run(scanId, c.idx, JSON.stringify(c.files), c.estTokens);
}

function rowToChunk(r: Record<string, unknown>): ChunkRow {
  return {
    id: r.id as number,
    scanId: r.scan_id as string,
    idx: r.idx as number,
    files: JSON.parse(r.files as string) as string[],
    estTokens: r.est_tokens as number,
    status: r.status as string,
    error: (r.error as string) ?? null,
  };
}

export function getPendingChunks(scanId: string): ChunkRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM scan_chunks WHERE scan_id = ? AND status = 'pending' ORDER BY idx")
    .all(scanId) as Array<Record<string, unknown>>;
  return rows.map(rowToChunk);
}

export function setChunkStatus(id: number, status: string, error?: string): void {
  getDb().prepare("UPDATE scan_chunks SET status = ?, error = ? WHERE id = ?").run(status, error ?? null, id);
}

/** Chunks left 'running' by a crashed/killed process become pending again. */
export function resetRunningChunks(scanId: string): void {
  getDb().prepare("UPDATE scan_chunks SET status = 'pending' WHERE scan_id = ? AND status = 'running'").run(scanId);
}

/* ── scan files (source cache for the code viewer / validation) ──────────── */

export function saveScanFile(scanId: string, path: string, content: string, lines: number): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO scan_files (scan_id, path, content, lines) VALUES (?, ?, ?, ?)")
    .run(scanId, path, content, lines);
}

export function getScanFileLines(scanId: string): Map<string, number> {
  const rows = getDb().prepare("SELECT path, lines FROM scan_files WHERE scan_id = ?").all(scanId) as Array<{ path: string; lines: number }>;
  return new Map(rows.map((r) => [r.path, r.lines]));
}

export function getScanFile(scanId: string, path: string): { path: string; content: string; lines: number } | null {
  const r = getDb().prepare("SELECT path, content, lines FROM scan_files WHERE scan_id = ? AND path = ?").get(scanId, path) as
    | { path: string; content: string; lines: number }
    | undefined;
  return r ?? null;
}

export function getRunningChunk(scanId: string): ChunkRow | null {
  const r = getDb()
    .prepare("SELECT * FROM scan_chunks WHERE scan_id = ? AND status = 'running' ORDER BY idx LIMIT 1")
    .get(scanId) as Record<string, unknown> | undefined;
  return r ? rowToChunk(r) : null;
}

/* ── findings ────────────────────────────────────────────────────────────── */

export interface FindingInput {
  filePath: string;
  lineStart: number | null;
  lineEnd: number | null;
  severity: string;
  category: string;
  title: string;
  explanation: string;
  suggestedFix: string | null;
  confidence: number | null;
}

export interface Finding extends FindingInput {
  id: number;
  scanId: string;
  createdAt: string;
}

export function insertFinding(scanId: string, f: FindingInput): boolean {
  const db = getDb();
  // Dedupe: same file + same starting line + same normalized title
  const normTitle = f.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const dupe = db
    .prepare(
      `SELECT 1 FROM findings WHERE scan_id = ? AND file_path = ? AND line_start IS ? AND
       lower(replace(replace(title, '-', ''), '_', '')) = ? LIMIT 1`,
    )
    .get(scanId, f.filePath, f.lineStart, normTitle.replace(/ /g, ""));
  if (dupe) return false;

  db.prepare(
    `INSERT INTO findings (scan_id, file_path, line_start, line_end, severity, category, title, explanation, suggested_fix, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(scanId, f.filePath, f.lineStart, f.lineEnd, f.severity, f.category, f.title, f.explanation, f.suggestedFix, f.confidence, new Date().toISOString());
  return true;
}

export function getFindings(scanId: string): Finding[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM findings WHERE scan_id = ? ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
       confidence DESC`,
    )
    .all(scanId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    scanId: r.scan_id as string,
    filePath: r.file_path as string,
    lineStart: (r.line_start as number) ?? null,
    lineEnd: (r.line_end as number) ?? null,
    severity: r.severity as string,
    category: r.category as string,
    title: r.title as string,
    explanation: r.explanation as string,
    suggestedFix: (r.suggested_fix as string) ?? null,
    confidence: (r.confidence as number) ?? null,
    createdAt: r.created_at as string,
  }));
}

export function getFindingCounts(scanId: string): Record<string, number> {
  const rows = getDb()
    .prepare("SELECT severity, COUNT(*) AS n FROM findings WHERE scan_id = ? GROUP BY severity")
    .all(scanId) as Array<{ severity: string; n: number }>;
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const r of rows) counts[r.severity] = r.n;
  return counts;
}
