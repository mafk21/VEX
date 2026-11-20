import crypto from "node:crypto";
import { getGitHubToken, getGeminiKey, readConfig, saveGeminiModels } from "./config";
import {
  createScan, updateScan, getScan, insertChunks, getPendingChunks, setChunkStatus,
  resetRunningChunks, saveScanFile, getScanFileLines, insertFinding, getResumableScans,
  getCachedRepo, getDb, getFindings, getScanFile, updateFinding, type Coverage, type ChunkRow,
} from "./db";
import { fetchRepoTree, fetchFileContent } from "./repo-fetch";
import { filterTree, MAX_FILE_BYTES } from "./filter";
import { planChunks, CHUNK_TOKEN_BUDGET, estimateTokens, numberLines } from "./packer";

/** Deep scans reason harder over smaller chunks. */
const DEEP_CHUNK_TOKEN_BUDGET = 60_000;
import { buildScanPrompt, buildVerifyPrompt, prepareFile, FINDINGS_RESPONSE_SCHEMA, type NumberedFile } from "./prompt";
import { callGeminiForFindings, quickCandidates, deepCandidates, probeModel, validateGeminiKey, DEFAULT_MODEL, type RawFinding } from "./gemini";
import { scanFileForPatterns } from "./patterns";

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
const GEMINI_MIN_INTERVAL_MS = 5_000; // ≤12 req/min — under the 15 RPM free tier
const DEEP_MIN_INTERVAL_MS = 13_000; // ~4.6 req/min — 3.8 Flash free tier is only 5 RPM
const FREE_TIER_TPM = 200_000; // input tokens/min pacing (free tier 250K — headroom for retries)
const FREE_TIER_RPM = 12;
const CONTENT_FETCH_CONCURRENCY = 4;

const g = globalThis as unknown as {
  __vexWorkers?: Map<string, { cancel: boolean }>;
  __vexLastGeminiCall?: number;
  __vexGeminiLog?: Array<{ at: number; tokens: number }>;
};
const workers = (g.__vexWorkers ??= new Map());

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Rate pacing that respects BOTH free-tier windows: requests/min AND input
 * tokens/min. A fixed interval alone lets several big chunks land in the same
 * minute and 429-storm; tracking a rolling token window prevents that.
 */
async function throttleGemini(estTokens: number, minIntervalMs: number): Promise<void> {
  const log = (g.__vexGeminiLog ??= []);
  for (;;) {
    const now = Date.now();
    while (log.length > 0 && now - log[0].at > 60_000) log.shift();
    const tokensInWindow = log.reduce((sum, e) => sum + e.tokens, 0);
    const intervalOk = now - (g.__vexLastGeminiCall ?? 0) >= minIntervalMs;
    if (intervalOk && log.length < FREE_TIER_RPM && tokensInWindow + estTokens <= FREE_TIER_TPM) break;
    await sleep(2_000);
  }
  log.push({ at: Date.now(), tokens: estTokens });
  g.__vexLastGeminiCall = Date.now();
}

/**
 * Find a not-yet-tried candidate model this key can actually call.
 * Gemini quotas are per model, so a hunt can survive one model's daily
 * exhaustion by hopping to another (each is verified with a cheap probe).
 */
async function fallbackModel(key: string, deep: boolean, tried: Set<string>): Promise<string | null> {
  const models = readConfig().geminiModels ?? [];
  for (const candidate of (deep ? deepCandidates(models) : quickCandidates(models)).slice(0, 5)) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    const probe = await probeModel(key, candidate);
    if (probe.ok) return candidate;
  }
  return null;
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

    // Gemini quotas are per model — if one model's daily bucket runs dry
    // mid-hunt, hop to the next candidate instead of killing the scan.
    let currentModel = scan.model ?? DEFAULT_MODEL;
    const modelsTried = new Set<string>([currentModel]);

    for (const chunk of pending) {
      if (cancelled()) return;
      setChunkStatus(chunk.id, "running");

      const fileSpecs = chunk.files.map((f) => {
        const [p, s] = f.split("|");
        return { path: p, size: Number(s) || 0 };
      });

      // Fetch this chunk's file contents (bounded concurrency)
      const numbered: NumberedFile[] = [];
      const raws: Array<{ path: string; content: string }> = [];
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
          raws.push({ path: r.prepared.path, content: r.raw });
          saveScanFile(scanId, r.prepared.path, r.raw, r.prepared.lines);
        }
      }

      // Deterministic pattern pass — runs locally, costs zero quota, and is
      // already grounded, so findings go straight to the DB.
      for (const r of raws) {
        for (const p of scanFileForPatterns(r.path, r.content)) {
          insertFinding(scanId, {
            filePath: p.file,
            lineStart: p.line_start,
            lineEnd: p.line_end,
            severity: p.severity,
            category: p.category,
            title: p.title,
            explanation: p.explanation,
            suggestedFix: p.suggested_fix,
            confidence: p.confidence,
          });
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
        // Retry the chunk on model fallback when a model's daily quota runs dry.
        let attempts = 0;
        while (attempts++ < 3) {
          await throttleGemini(chunk.estTokens, scan.mode === "deep" ? DEEP_MIN_INTERVAL_MS : GEMINI_MIN_INTERVAL_MS);
          const result = await callGeminiForFindings(
            geminiKey,
            currentModel,
            prompt,
            FINDINGS_RESPONSE_SCHEMA,
            scan.mode === "deep" ? { thinking: "high" } : {},
          );
          if (result.ok) {
            findings = result.findings;
            break;
          }
          callError = result.error;
          if (!result.quotaExhausted) break;
          const next = await fallbackModel(geminiKey, scan.mode === "deep", modelsTried);
          if (!next) {
            setChunkStatus(chunk.id, "failed", callError);
            updateScan(scanId, {
              status: "failed",
              error: `Free quota exhausted on every model this key can use (tried: ${[...modelsTried].join(", ")}). Daily quotas reset at midnight Pacific Time — or add a paid key for much higher limits.`,
              finishedAt: new Date().toISOString(),
            });
            return;
          }
          currentModel = next;
          updateScan(scanId, { model: next });
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
      filesScanned += numbered.length; // files only count as scanned when their chunk was actually analyzed
      advanceProgress(scanId);
      const cov = getScan(scanId)?.coverage;
      if (cov) updateScan(scanId, { coverage: { ...cov, files_scanned: filesScanned } });
    }

    // ── Verification pass: re-examine the strongest findings against their
    // full files. Deflates false positives, sharpens real ones. Best-effort:
    // it must never fail or block the hunt's completion.
    if (!MOCK && !flag.cancel) {
      await verifyTopFindings(scanId, geminiKey, currentModel, scan.mode === "deep", scan.repoFullName);
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
          ? `${chunksFailed} of ${totalChunks} chunks failed — partial results shown.${firstChunkError ? ` First failure: ${firstChunkError}` : ""}`
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

/* ── verification pass ───────────────────────────────────────────────────── */

const VERIFY_LIMIT = 10;
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

async function verifyTopFindings(scanId: string, key: string, model: string, deep: boolean, repo: string): Promise<void> {
  try {
    const top = getFindings(scanId)
      .filter((f) => f.status === "open")
      .sort((a, b) => (SEV_RANK[a.severity] ?? 4) - (SEV_RANK[b.severity] ?? 4) || (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, VERIFY_LIMIT);
    for (const f of top) {
      const file = getScanFile(scanId, f.filePath);
      if (!file) continue;
      const prompt = buildVerifyPrompt({ repo, path: f.filePath, numbered: numberLines(file.content).text, finding: f });
      await throttleGemini(estimateTokens(file.content.length) + 2_000, deep ? DEEP_MIN_INTERVAL_MS : GEMINI_MIN_INTERVAL_MS);
      const res = await callGeminiForFindings(key, model, prompt, FINDINGS_RESPONSE_SCHEMA, deep ? { thinking: "high" } : {});
      if (!res.ok) {
        if (res.quotaExhausted) break; // out of budget — remaining findings stand as-is
        continue;
      }
      if (res.findings.length === 0) {
        // Verifier found nothing real — deflate confidence and flag it
        updateFinding(f.id, {
          confidence: Math.round(((f.confidence ?? 0.8) * 0.5) * 100) / 100,
          explanation: `⚠ Verification pass could not confirm this — treat with skepticism.\n\n${f.explanation}`,
        });
      } else {
        const v = res.findings[0];
        updateFinding(f.id, {
          severity: v.severity,
          confidence: v.confidence,
          explanation: `✓ Verified by a second pass.\n\n${v.explanation}`,
          suggestedFix: v.suggested_fix,
        });
      }
    }
  } catch {
    /* verification is best-effort */
  }
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
