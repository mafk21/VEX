"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ScanReport, { SEV_STYLE, type Finding, type ReportScan } from "./scan-report";

interface Scan extends ReportScan {
  mode: string;
  totalChunks: number;
  doneChunks: number;
  coverage: (ReportScan["coverage"] & { tree_truncated?: boolean }) | null;
}

interface CurrentChunk {
  idx: number;
  files: string[];
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  queued: { label: "queued", cls: "border-line text-ink-dim" },
  fetching: { label: "fetching repo", cls: "border-warn/50 text-warn" },
  scanning: { label: "hunting", cls: "border-accent/50 text-accent" },
  complete: { label: "complete", cls: "border-accent/50 text-accent" },
  failed: { label: "failed", cls: "border-danger/50 text-danger" },
  cancelled: { label: "cancelled", cls: "border-line text-ink-dim" },
};

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function ScanView({ scanId }: { scanId: string }) {
  const router = useRouter();
  const [scan, setScan] = useState<Scan | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [findings, setFindings] = useState<Finding[]>([]);
  const [currentChunk, setCurrentChunk] = useState<CurrentChunk | null>(null);
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/scans/${scanId}`);
      const data = await res.json();
      if (!data.ok) {
        setNotFound(true);
        return;
      }
      setScan(data.scan);
      setCounts(data.findings);
      setCurrentChunk(data.currentChunk ?? null);
      setServerNow(data.serverNow ?? null);
      if (["complete", "failed", "cancelled"].includes(data.scan.status)) {
        const f = await fetch(`/api/scans/${scanId}/findings`).then((r) => r.json());
        if (f.ok) setFindings(f.findings);
        return; // stop polling
      }
    } catch {
      /* transient — retry on next tick */
    }
    timer.current = setTimeout(poll, 2000);
  }, [scanId]);

  useEffect(() => {
    poll();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  async function cancel() {
    await fetch(`/api/scans/${scanId}/cancel`, { method: "POST" });
    poll();
  }

  async function rescan() {
    if (!scan) return;
    setRescanning(true);
    const res = await fetch("/api/scans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoFullName: scan.repoFullName }),
    });
    const data = await res.json();
    if (data.scanId) router.push(`/scans/${data.scanId}`);
    else setRescanning(false);
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="text-ink-dim">Scan not found.</p>
        <Link href="/dashboard" className="mt-4 inline-block text-accent underline underline-offset-2">← back to dashboard</Link>
      </main>
    );
  }
  if (!scan) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="h-8 w-40 animate-pulse rounded bg-panel" />
        <div className="mt-6 h-44 animate-pulse rounded-xl border border-line bg-panel" />
      </main>
    );
  }

  const st = STATUS_LABEL[scan.status] ?? STATUS_LABEL.queued;
  const active = ["queued", "fetching", "scanning"].includes(scan.status);
  const progress = scan.totalChunks > 0 ? scan.doneChunks / scan.totalChunks : 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const end = scan.finishedAt ?? serverNow;
  const elapsed = end ? new Date(end).getTime() - new Date(scan.createdAt).getTime() : 0;
  const eta =
    active && scan.status === "scanning" && scan.doneChunks > 0
      ? (elapsed / scan.doneChunks) * (scan.totalChunks - scan.doneChunks)
      : null;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8">
      {/* nav + actions */}
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="font-mono text-xs text-ink-dim hover:text-accent">← dashboard</Link>
        <div className="flex items-center gap-2">
          {!active && (
            <>
              <a
                href={`/api/scans/${scanId}/export?format=md`}
                title="Download report as Markdown"
                className="rounded-lg border border-line px-3 py-1.5 font-mono text-xs text-ink-dim transition hover:border-accent/50 hover:text-accent"
              >
                ↓ md
              </a>
              <a
                href={`/api/scans/${scanId}/export?format=json`}
                title="Download report as JSON"
                className="rounded-lg border border-line px-3 py-1.5 font-mono text-xs text-ink-dim transition hover:border-accent/50 hover:text-accent"
              >
                ↓ json
              </a>
              <button
                onClick={rescan}
                disabled={rescanning}
                className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-1.5 font-mono text-xs font-bold text-accent transition hover:bg-accent/20 disabled:opacity-40"
              >
                {rescanning ? "starting…" : "↻ re-scan"}
              </button>
            </>
          )}
          {active && (
            <button
              onClick={cancel}
              className="rounded-lg border border-danger/40 px-4 py-1.5 font-mono text-xs text-danger transition hover:bg-danger/10"
            >
              ✕ cancel
            </button>
          )}
        </div>
      </div>

      {/* header card */}
      <div className="mt-4 rounded-xl border border-line bg-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-lg font-bold">{scan.repoFullName}</h1>
            <p className="mt-0.5 font-mono text-[11px] text-ink-dim">
              scan {scan.id.slice(0, 8)} · {scan.mode} mode{scan.model ? ` · ${scan.model}` : ""} · {fmtDuration(elapsed)}
              {active && eta !== null && ` · ~${fmtDuration(eta)} left`}
            </p>
          </div>
          <span className={`flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs ${st.cls}`}>
            {active && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
            {st.label}
          </span>
        </div>

        {/* progress */}
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-panel-2">
          <div
            className={`h-full rounded-full transition-all duration-500 ${scan.status === "failed" ? "bg-danger" : "bg-accent"}`}
            style={{ width: `${scan.status === "fetching" ? 8 : Math.round(progress * 100)}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-ink-dim">
          <span>chunks {scan.doneChunks}/{scan.totalChunks}</span>
          {scan.coverage && (
            <span>
              files {scan.coverage.files_scanned}/{scan.coverage.files_selected} scanned · {scan.coverage.files_total} in repo
              {scan.coverage.files_oversized > 0 && ` · ${scan.coverage.files_oversized} oversized skipped`}
              {scan.coverage.tree_truncated && " · ⚠ huge repo (tree truncated)"}
            </span>
          )}
          <span>{total} findings</span>
        </div>

        {/* live: which files are under the microscope */}
        {active && scan.status === "scanning" && currentChunk && (
          <div className="mt-4 rounded-lg border border-line bg-void p-3 font-mono text-[11px] text-ink-dim">
            <span className="text-accent">⌖ scanning chunk {currentChunk.idx + 1}/{scan.totalChunks}</span>
            <span className="ml-3">
              {currentChunk.files.slice(0, 3).join(", ")}
              {currentChunk.files.length > 3 && ` +${currentChunk.files.length - 3} more`}
            </span>
            <span className="ml-3 text-ink-dim/60">· throttled to ~12 Gemini calls/min (free-tier friendly)</span>
          </div>
        )}
        {active && scan.status === "fetching" && (
          <div className="mt-4 rounded-lg border border-line bg-void p-3 font-mono text-[11px] text-ink-dim">
            <span className="text-warn">↓ fetching repository tree &amp; planning chunks…</span>
          </div>
        )}

        {/* errors / quota */}
        {scan.error && (
          <p
            className={`mt-4 rounded-lg border px-4 py-2 text-sm ${
              /quota/i.test(scan.error)
                ? "border-warn/40 bg-warn/5 text-warn"
                : "border-danger/30 bg-danger/5 text-danger"
            }`}
          >
            {/quota/i.test(scan.error) ? "⚠ " : "✕ "}
            {scan.error}
          </p>
        )}
      </div>

      {/* live severity counters */}
      {active && total > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(counts)
            .filter(([, n]) => n > 0)
            .map(([s, n]) => (
              <span key={s} className={`rounded-full border px-3 py-1 font-mono text-xs ${SEV_STYLE[s]}`}>
                {n} {s}
              </span>
            ))}
        </div>
      )}

      {/* final states */}
      {!active && findings.length > 0 && <ScanReport scan={scan} findings={findings} />}

      {!active && findings.length === 0 && scan.status === "complete" && !scan.error && (
        <div className="mt-6 rounded-xl border border-accent/30 bg-accent/5 p-10 text-center">
          <p className="text-xl text-accent">✓ Clean hunt</p>
          <p className="mt-2 text-sm text-ink-dim">
            VEX found nothing worth flagging across {scan.coverage?.files_scanned ?? 0} scanned files.
          </p>
        </div>
      )}

      {!active && findings.length === 0 && scan.status === "complete" && scan.error && (
        <div className="mt-6 rounded-xl border border-warn/30 bg-warn/5 p-10 text-center">
          <p className="text-xl text-warn">⚠ Incomplete hunt</p>
          <p className="mt-2 text-sm text-ink-dim">
            Some chunks failed, so only part of the repo was analyzed — treat zero findings with
            suspicion and hit re-scan.
          </p>
        </div>
      )}

      {!active && findings.length === 0 && scan.status === "failed" && (
        <div className="mt-6 rounded-xl border border-danger/30 bg-danger/5 p-10 text-center">
          <p className="text-xl text-danger">✕ Hunt failed</p>
          <p className="mt-2 text-sm text-ink-dim">Fix the issue above and hit re-scan.</p>
        </div>
      )}
    </main>
  );
}
