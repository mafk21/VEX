import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { vexDir } from "./vexdir";
import type { RepoSummary } from "./github";

/**
 * Local SQLite database at .vex/vex.db using Node's built-in SQLite.
 * No native modules, no external services. Schema covers the full product
 * (repos cache + scans + findings); scan tables are exercised from Sprint 2.
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
  mode          TEXT NOT NULL DEFAULT 'quick',   -- quick | deep
  status        TEXT NOT NULL DEFAULT 'queued',  -- queued | fetching | scanning | complete | failed
  model         TEXT,
  total_chunks  INTEGER NOT NULL DEFAULT 0,
  done_chunks   INTEGER NOT NULL DEFAULT 0,
  coverage      TEXT,                            -- json: {files_total, files_scanned, tokens_est}
  error         TEXT,
  created_at    TEXT NOT NULL,
  finished_at   TEXT
);

CREATE TABLE IF NOT EXISTS scan_chunks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id    TEXT NOT NULL REFERENCES scans(id),
  idx        INTEGER NOT NULL,
  files      TEXT NOT NULL,                      -- json array of paths
  est_tokens INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'pending',    -- pending | running | done | failed
  error      TEXT
);

CREATE TABLE IF NOT EXISTS findings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id       TEXT NOT NULL REFERENCES scans(id),
  file_path     TEXT NOT NULL,
  line_start    INTEGER,
  line_end      INTEGER,
  severity      TEXT NOT NULL,                   -- critical | high | medium | low | info
  category      TEXT NOT NULL,                   -- security | bug | logic | quality
  title         TEXT NOT NULL,
  explanation   TEXT NOT NULL,
  suggested_fix TEXT,
  confidence    REAL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_findings_scan ON findings(scan_id);
CREATE INDEX IF NOT EXISTS idx_chunks_scan ON scan_chunks(scan_id);
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

export function cacheRepos(repos: RepoSummary[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO repos (id, full_name, name, description, language, private, default_branch, updated_at, html_url, cached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      full_name = excluded.full_name,
      name = excluded.name,
      description = excluded.description,
      language = excluded.language,
      private = excluded.private,
      default_branch = excluded.default_branch,
      updated_at = excluded.updated_at,
      html_url = excluded.html_url,
      cached_at = excluded.cached_at
  `);
  const seen = db.prepare("SELECT id FROM repos");
  const seenIds = new Set((seen.all() as Array<{ id: number }>).map((r) => r.id));
  for (const r of repos) {
    upsert.run(
      r.id,
      r.fullName,
      r.name,
      r.description,
      r.language,
      r.private ? 1 : 0,
      r.defaultBranch,
      r.updatedAt,
      r.htmlUrl,
      now,
    );
    seenIds.delete(r.id);
  }
  // Drop repos that no longer exist / are no longer accessible
  const del = db.prepare("DELETE FROM repos WHERE id = ?");
  for (const stale of seenIds) del.run(stale);
}

export function getCachedRepos(): RepoSummary[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM repos ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>;
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

export function clearCachedRepos(): void {
  getDb().exec("DELETE FROM repos");
}
