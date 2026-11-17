"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Scan {
  id: string;
  repoFullName: string;
  mode: string;
  status: string;
  model: string | null;
  totalChunks: number;
  doneChunks: number;
  coverage: {
    files_total: number;
    files_selected: number;
    files_scanned: number;
    files_skipped: number;
    files_oversized: number;
    est_tokens: number;
    tree_truncated: boolean;
  } | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface Finding {
  id: number;
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

const SEV_STYLE: Record<string, string> = {
  critical: "border-danger/60 bg-danger/10 text-danger",
  high: "border-orange-500/40 bg-orange-500/10 text-orange-400",
  medium: "border-warn/50 bg-warn/10 text-warn",
  low: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  info: "border-line bg-panel-2 text-ink-dim",
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  queued: { label: "queued", cls: "text-ink-dim" },
  fetching: { label: "fetching repo…", cls: "text-warn" },
  scanning: { label: "hunting…", cls: "text-accent" },
  complete: { label: "complete", cls: "text-accent" },
  failed: { label: "failed", cls: "text-danger" },
  cancelled: { label: "cancelled", cls: "text-ink-dim" },
};

export default function ScanStatus({ scanId }: { scanId: string }) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [findings, setFindings] = useState<Finding[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    const res = await fetch(`/api/scans/${scanId}`);
    const data = await res.json();
    if (!data.ok) {
      setNotFound(true);
      return;
    }
    setScan(data.scan);
    setCounts(data.findings);
    if (["complete", "failed", "cancelled"].includes(data.scan.status)) {
      const f = await fetch(`/api/scans/${scanId}/findings`).then((r) => r.json());
      if (f.ok) setFindings(f.findings);
      return; // stop polling
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

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="text-ink-dim">Scan not found.</p>
        <Link href="/dashboard" className="mt-4 inline-block text-accent underline underline-offset-2">← back to dashboard</Link>
      </main>
    );
  }
  if (!scan) return <main className="mx-auto max-w-3xl px-6 py-20 text-center text-ink-dim">Loading…</main>;

  const st = STATUS_LABEL[scan.status] ?? STATUS_LABEL.queued;
  const active = ["queued", "fetching", "scanning"].includes(scan.status);
  const progress = scan.totalChunks > 0 ? scan.doneChunks / scan.totalChunks : 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-8">
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="font-mono text-xs text-ink-dim hover:text-accent">← dashboard</Link>
        <span className="font-mono text-xs text-ink-dim">scan {scan.id.slice(0, 8)}</span>
      </div>

      <div className="mt-6 rounded-xl border border-line bg-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-mono text-lg font-bold">{scan.repoFullName}</h1>
          <span className={`font-mono text-sm ${st.cls}`}>
            {scan.status === "scanning" && <span className="mr-2 inline-block animate-pulse">●</span>}
            {st.label}
          </span>
        </div>

        {/* progress */}
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-panel-2">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-ink-dim">
          <span>chunks {scan.doneChunks}/{scan.totalChunks}</span>
          {scan.model && <span>model {scan.model}</span>}
          {scan.coverage && (
            <span>
              files {scan.coverage.files_scanned}/{scan.coverage.files_selected} selected
              ({scan.coverage.files_total} in repo)
            </span>
          )}
          <span>{total} findings so far</span>
        </div>

        {scan.error && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">✕ {scan.error}</p>
        )}

        {active && (
          <button
            onClick={cancel}
            className="mt-4 rounded-lg border border-danger/40 px-4 py-2 font-mono text-xs text-danger transition hover:bg-danger/10"
          >
            ✕ cancel scan
          </button>
        )}
      </div>

      {/* severity summary */}
      {(total > 0 || scan.status === "complete") && (
        <div className="mt-6 grid grid-cols-5 gap-2">
          {(["critical", "high", "medium", "low", "info"] as const).map((s) => (
            <div key={s} className={`rounded-lg border px-3 py-2 text-center ${SEV_STYLE[s]}`}>
              <div className="font-mono text-lg font-bold">{counts[s] ?? 0}</div>
              <div className="font-mono text-[10px] uppercase">{s}</div>
            </div>
          ))}
        </div>
      )}

      {/* findings list (basic — full report UI lands in Sprint 3) */}
      {findings.length > 0 && (
        <div className="mt-6 space-y-3">
          {findings.map((f) => (
            <div key={f.id} className="rounded-xl border border-line bg-panel">
              <button
                onClick={() => setExpanded(expanded === f.id ? null : f.id)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left"
              >
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase ${SEV_STYLE[f.severity]}`}>
                  {f.severity}
                </span>
                <span className="flex-1 text-sm font-medium">{f.title}</span>
                <span className="shrink-0 font-mono text-[11px] text-ink-dim">
                  {f.filePath}
                  {f.lineStart ? `:${f.lineStart}` : ""}
                </span>
              </button>
              {expanded === f.id && (
                <div className="border-t border-line px-5 py-4">
                  <p className="text-sm leading-relaxed text-ink-dim">{f.explanation}</p>
                  {f.suggestedFix && (
                    <div className="mt-3">
                      <div className="font-mono text-[10px] uppercase text-accent">suggested fix</div>
                      <pre className="mt-1 overflow-x-auto rounded-lg bg-void p-3 text-xs leading-relaxed text-ink">{f.suggestedFix}</pre>
                    </div>
                  )}
                  <div className="mt-3 font-mono text-[10px] text-ink-dim">
                    category: {f.category}
                    {f.confidence !== null && ` · confidence ${(f.confidence * 100).toFixed(0)}%`}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {scan.status === "complete" && findings.length === 0 && (
        <div className="mt-6 rounded-xl border border-accent/30 bg-accent/5 p-8 text-center">
          <p className="text-lg text-accent">✓ Clean hunt</p>
          <p className="mt-1 text-sm text-ink-dim">VEX found nothing worth flagging in the scanned files.</p>
        </div>
      )}
    </main>
  );
}
