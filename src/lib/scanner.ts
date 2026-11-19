import crypto from "node:crypto";
import { getGitHubToken, getGeminiKey, readConfig, saveGeminiModels } from "./config";
import {
  createScan, updateScan, getScan, insertChunks, getPendingChunks, setChunkStatus,
  resetRunningChunks, saveScanFile, getScanFileLines, insertFinding, getResumableScans,
  getCachedRepo, getDb, type Coverage, type ChunkRow,
} from "./db";
import { fetchRepoTree, fetchFileContent } from "./repo-fetch";
import { filterTree, MAX_FILE_BYTES } from "./filter";
import { planChunks, CHUNK_TOKEN_BUDGET } from "./packer";

/** Deep scans reason harder over smaller chunks. */
const DEEP_CHUNK_TOKEN_BUDGET = 60_000;
import { buildScanPrompt, prepareFile, FINDINGS_RESPONSE_SCHEMA, type NumberedFile } from "./prompt";
import { callGeminiForFindings, quickCandidates, deepCandidates, probeModel, validateGeminiKey, DEFAULT_MODEL, type RawFinding } from "./gemini";

/**
 * In-process scan worker. Because VEX runs locally (no serverless timeouts),
 * scans are processed by a simple sequential queue with a global throttle
 * (~12 Gemini calls/min) to respect the free tier's ~15 RPM limit.
 *
 * - Resumable: pending chunks live in SQLite; on boot, resumeIncompleteScans()
 *   picks up anything interrupted.
 * - Cancellable: cancelScan() flips an in-memory flag the loop checks.
 * - Mock mode: VEX_MOCK_GEMINI=1 returns canned findings (dev/sandbox demo).
 */

const MOCK = process.env.VEX_MOCK_GEMINI === "1";
const GEMINI_MIN_INTERVAL_MS = 5_000; // ≤12 req/min — fits Flash-Lite's 15 RPM free tier
const DEEP_MIN_INTERVAL_MS = 13_000; // ~4.6 req/min — 3.8 Flash free tier is only 5 RPM
const CONTENT_FETCH_CONCURRENCY = 4;

const g = globalThis as unknown as {
  __vexWorkers?: Map<string, { cancel: boolean }>;
  __vexLastGeminiCall?: number;
};
const workers = (g.__vexWorkers ??= new Map());

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttleGemini(minIntervalMs: number): Promise<void> {
  const wait = minIntervalMs - (Date.now() - (g.__vexLastGeminiCall ?? 0));
  if (wait > 0) await sleep(wait);
  g.__vexLastGeminiCall = Date.now();
}

export type StartResult = { ok: true; scanId: string } | { ok: false; error: string };

export async function startScan(repoFullName: string, mode: "quick" | "deep" = "quick"): Promise<StartResult> {
  const geminiKey = getGeminiKey();
  if (!getGitHubToken()) return { ok: false, error: "GitHub is not connected." };
  if (!geminiKey) return { ok: false, error: "Gemini is not connected." };

  const repo = getCachedRepo(repoFullName);
  if (!repo) return { ok: false, error: `Unknown repository: ${repoFullName}. Refresh the repo list.` };

  const storedModels = readConfig().geminiModels ?? [];
  const deep = mode === "deep";

  // Refresh the key's model list (cheap, not quota-counted) — Google deprecates
  // models often, and their list includes models new keys can't actually call.
  let models = storedModels;
  if (!MOCK) {
    const v = await validateGeminiKey(geminiKey);
    if (v.ok) {
      if (JSON.stringify(v.models) !== JSON.stringify(storedModels)) saveGeminiModels(v.models);
      models = v.models;
    }
  }

  // Pre-flight probe: try candidates in preference order until one responds.
  // This fails fast with a clear message instead of burning a whole scan on a
  // model the key can't call (e.g. deprecated 2.5 models on new keys).
  let model: string | null = null;
  let probeError: string | null = null;
  const candidates = (deep ? deepCandidates(models) : quickCandidates(models)).slice(0, 3);
  if (MOCK) {
    model = candidates[0] ?? DEFAULT_MODEL;
  } else {
    for (const candidate of candidates) {
      const probe = await probeModel(geminiKey, candidate);
      if (probe.ok) {
        model = candidate;
        break;
      }
      probeError = probe.error ?? null;
    }
    if (!model) {
      return {
        ok: false,
        error: deep
          ? `Deep scan pre-flight failed${probeError ? ` — ${probeError}` : ""}. Deep works best on a paid-tier key; quick hunt may still work.`
          : `Gemini pre-flight failed${probeError ? ` — ${probeError}` : ""}. Check your key and quota, then retry.`,
      };
    }
  }

  const scanId = crypto.randomUUID();
  createScan(scanId, repoFullName, mode, model);
  void runScan(scanId);
  return { ok: true, scanId };
}

export function cancelScan(scanId: string): boolean {
  const w = workers.get(scanId);
  if (w) w.cancel = true;
  const scan = getScan(scanId);
  if (scan && ["queued", "fetching", "scanning"].includes(scan.status)) {
    updateScan(scanId, { status: "cancelled", finishedAt: new Date().toISOString() });
    return true;
  }
  return false;
}

/** Called once at server boot (instrumentation.ts) to resume interrupted scans. */
export function resumeIncompleteScans(): void {
  try {
    for (const scan of getResumableScans()) {
      if (!workers.has(scan.id)) void runScan(scan.id);
    }
  } catch {
    /* db may not exist yet on first boot — nothing to resume */
  }
}

async function runScan(scanId: string): Promise<void> {
  if (workers.has(scanId)) return; // already running (dev HMR guard)
  const flag = { cancel: false };
  workers.set(scanId, flag);

  try {
    const scan = getScan(scanId);
    if (!scan) return;
    const token = getGitHubToken();
    const geminiKey = getGeminiKey();
    const repo = getCachedRepo(scan.repoFullName);
    if (!token || !geminiKey || !repo) {
      updateScan(scanId, { status: "failed", error: "Missing GitHub/Gemini credentials or unknown repo.", finishedAt: new Date().toISOString() });
      return;
    }

    const cancelled = () => flag.cancel;

    // ── Phase 1: fetch + plan (skipped on resume if chunks already exist) ──
    let pending = getPendingChunks(scanId);
    if (scan.status === "queued" || scan.status === "fetching" || pending.length === 0) {
      updateScan(scanId, { status: "fetching", error: null });

      let entries;
      let treeTruncated = false;
      try {
        const tree = await fetchRepoTree(token, scan.repoFullName, repo.defaultBranch);
        entries = tree.entries;
        treeTruncated = tree.truncated;
      } catch (e) {
        updateScan(scanId, { status: "failed", error: e instanceof Error ? e.message : "Failed to fetch repo tree.", finishedAt: new Date().toISOString() });
        return;
      }
      if (cancelled()) return;

      const { selected, skipped, oversized, totalBlobs } = filterTree(entries);
      if (selected.length === 0) {
        updateScan(scanId, { status: "failed", error: "No scannable source files found in this repository.", finishedAt: new Date().toISOString() });
        return;
      }

      const plans = planChunks(selected, scan.mode === "deep" ? DEEP_CHUNK_TOKEN_BUDGET : CHUNK_TOKEN_BUDGET);
      insertChunks(
        scanId,
        plans.map((p) => ({ idx: p.idx, files: p.files.map((f) => `${f.path}|${f.size}`), estTokens: p.estTokens })),
      );

      const coverage: Coverage = {
        files_total: totalBlobs,
        files_selected: selected.length,
        files_scanned: 0,
        files_skipped: skipped,
        files_oversized: oversized,
        est_tokens: plans.reduce((a, c) => a + c.estTokens, 0),
        tree_truncated: treeTruncated,
      };
      updateScan(scanId, { status: "scanning", totalChunks: plans.length, doneChunks: 0, coverage });
      pending = getPendingChunks(scanId);
    } else {
      resetRunningChunks(scanId);
      pending = getPendingChunks(scanId);
    }

    // ── Phase 2: scan chunk by chunk ───────────────────────────────────────
    const inventory = readInventory(scanId);
    const totalChunks = getScan(scanId)?.totalChunks ?? pending.length;
    let filesScanned = getScan(scanId)?.coverage?.files_scanned ?? 0;
    let chunksFailed = 0;
    let firstChunkError: string | null = null;

    for (const chunk of pending) {
      if (cancelled()) return;
      setChunkStatus(chunk.id, "running");

      const fileSpecs = chunk.files.map((f) => {
        const [p, s] = f.split("|");
        return { path: p, size: Number(s) || 0 };
      });

      // Fetch this chunk's file contents (bounded concurrency)
      const numbered: NumberedFile[] = [];
      for (let i = 0; i < fileSpecs.length; i += CONTENT_FETCH_CONCURRENCY) {
        if (cancelled()) return;
        const batch = fileSpecs.slice(i, i + CONTENT_FETCH_CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (f) => {
            const content = await fetchFileContent(token, scan.repoFullName, f.path, repo.defaultBranch, MAX_FILE_BYTES);
            return content === null ? null : { prepared: prepareFile(f.path, content), raw: content };
          }),
        );
        for (const r of results) {
          if (!r) continue;
          numbered.push(r.prepared);
          saveScanFile(scanId, r.prepared.path, r.raw, r.prepared.lines);
          filesScanned++;
        }
      }

      if (numbered.length === 0) {
        setChunkStatus(chunk.id, "failed", "All file fetches failed");
        chunksFailed++;
        advanceProgress(scanId);
        continue;
      }

      const prompt = buildScanPrompt({
        repo: scan.repoFullName,
        chunkIdx: chunk.idx,
        totalChunks,
        inventory,
        files: numbered,
        deep: scan.mode === "deep",
      });

      // ── Gemini call (throttled) or mock ──
      let findings: RawFinding[] | null = null;
      let callError: string | null = null;

      if (MOCK) {
        findings = mockFindings(numbered);
      } else {
        await throttleGemini(scan.mode === "deep" ? DEEP_MIN_INTERVAL_MS : GEMINI_MIN_INTERVAL_MS);
        const result = await callGeminiForFindings(
          geminiKey,
          scan.model ?? DEFAULT_MODEL,
          prompt,
          FINDINGS_RESPONSE_SCHEMA,
          scan.mode === "deep" ? { thinking: "high" } : {},
        );
        if (result.ok) {
          findings = result.findings;
        } else {
          callError = result.error;
          if (result.quotaExhausted) {
            setChunkStatus(chunk.id, "failed", callError);
            updateScan(scanId, { status: "failed", error: callError, finishedAt: new Date().toISOString() });
            return;
          }
        }
      }

      if (findings === null) {
        setChunkStatus(chunk.id, "failed", callError ?? "unknown error");
        if (callError && !firstChunkError) firstChunkError = callError;
        chunksFailed++;
        advanceProgress(scanId);
        continue;
      }

      // Ground + store findings (only files actually in this chunk, lines clamped)
      const lineMap = getScanFileLines(scanId);
      const chunkPaths = new Set(numbered.map((f) => f.path));
      for (const f of findings) {
        if (!chunkPaths.has(f.file)) continue;
        const maxLines = lineMap.get(f.file) ?? 0;
        const lineStart = f.line_start === null ? null : Math.max(1, Math.min(f.line_start, Math.max(maxLines, 1)));
        const lineEnd = f.line_end === null ? lineStart : Math.max(lineStart ?? 1, Math.min(f.line_end, Math.max(maxLines, 1)));
        insertFinding(scanId, {
          filePath: f.file,
          lineStart,
          lineEnd,
          severity: f.severity,
          category: f.category,
          title: f.title,
          explanation: f.explanation,
          suggestedFix: f.suggested_fix,
          confidence: f.confidence,
        });
      }

      setChunkStatus(chunk.id, "done");
      advanceProgress(scanId);
      const cov = getScan(scanId)?.coverage;
      if (cov) updateScan(scanId, { coverage: { ...cov, files_scanned: filesScanned } });
    }

    // ── Done ───────────────────────────────────────────────────────────────
    const finalScan = getScan(scanId);
    if (!finalScan || finalScan.status === "cancelled") return;
    const allFailed = chunksFailed > 0 && chunksFailed >= totalChunks;
    updateScan(scanId, {
      status: allFailed ? "failed" : "complete",
      error: allFailed
        ? `All ${totalChunks} chunks failed.${firstChunkError ? ` Gemini said: ${firstChunkError}` : " Check your Gemini key and quota."}`
        : chunksFailed > 0
          ? `${chunksFailed} of ${totalChunks} chunks failed — partial results shown.`
          : null,
      finishedAt: new Date().toISOString(),
    });
  } catch (e) {
    updateScan(scanId, {
      status: "failed",
      error: e instanceof Error ? e.message : "Unexpected scanner error.",
      finishedAt: new Date().toISOString(),
    });
  } finally {
    workers.delete(scanId);
  }
}

function advanceProgress(scanId: string): void {
  const s = getScan(scanId);
  if (s) updateScan(scanId, { doneChunks: s.doneChunks + 1 });
}

/** Flat list of every file selected for this scan (from all chunk rows). */
function readInventory(scanId: string): string[] {
  return getAllChunks(scanId).flatMap((c) => c.files.map((f) => f.split("|")[0]));
}

function getAllChunks(scanId: string): ChunkRow[] {
  const rows = getDb().prepare("SELECT * FROM scan_chunks WHERE scan_id = ? ORDER BY idx").all(scanId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    scanId: r.scan_id as string,
    idx: r.idx as number,
    files: JSON.parse(r.files as string) as string[],
    estTokens: r.est_tokens as number,
    status: r.status as string,
    error: (r.error as string) ?? null,
  }));
}

/** Canned findings for VEX_MOCK_GEMINI=1 — exercises the full pipeline without the API. */
function mockFindings(files: NumberedFile[]): RawFinding[] {
  const out: RawFinding[] = [];
  const f0 = files[0];
  if (f0) {
    out.push({
      file: f0.path,
      line_start: 1,
      line_end: Math.min(5, f0.lines),
      severity: "high",
      category: "security",
      title: "[MOCK] Potential unsanitized input flow",
      explanation: "Mock finding: VEX_MOCK_GEMINI=1 is set, so this is a canned result to exercise the pipeline. In a real scan, Gemini's analysis appears here.",
      suggested_fix: "Run without VEX_MOCK_GEMINI to get a real analysis.",
      confidence: 0.9,
    });
  }
  const f1 = files[1] ?? files[0];
  if (f1) {
    out.push({
      file: f1.path,
      line_start: 1,
      line_end: Math.min(3, f1.lines),
      severity: "medium",
      category: "logic",
      title: "[MOCK] Suspicious control-flow pattern",
      explanation: "Mock finding #2 — verifies multi-finding parsing, severity ordering, and line grounding.",
      suggested_fix: null,
      confidence: 0.7,
    });
  }
  return out;
}
