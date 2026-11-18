"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SEV_STYLE } from "./scan-report";

interface HistoryScan {
  id: string;
  repoFullName: string;
  mode: string;
  status: string;
  model: string | null;
  createdAt: string;
  finishedAt: string | null;
  findings: Record<string, number>;
}

const STATUS_CLS: Record<string, string> = {
  complete: "text-accent",
  failed: "text-danger",
  cancelled: "text-ink-dim",
  queued: "text-ink-dim",
  fetching: "text-warn",
  scanning: "text-accent",
};

function fmtDur(a: string, b: string | null): string {
  if (!b) return "—";
  const s = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtWhen(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ScanHistory() {
  const [scans, setScans] = useState<HistoryScan[] | null>(null);

  useEffect(() => {
    fetch("/api/scans")
      .then((r) => r.json())
      .then((d) => setScans(d.ok ? d.scans : []))
      .catch(() => setScans([]));
  }, []);

  if (scans === null) {
    return (
      <div className="mt-6 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-line bg-panel" />
        ))}
      </div>
    );
  }

  if (scans.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-line bg-panel p-10 text-center">
        <p className="text-ink-dim">No hunts yet.</p>
        <Link href="/dashboard" className="mt-3 inline-block font-mono text-xs text-accent hover:underline underline-offset-2">
          pick a repo and start your first hunt →
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-2">
      {scans.map((s) => {
        const total = Object.values(s.findings).reduce((a, b) => a + b, 0);
        return (
          <Link
            key={s.id}
            href={`/scans/${s.id}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-panel px-5 py-4 transition hover:border-accent/40"
          >
            <span className="font-mono text-sm font-bold">{s.repoFullName}</span>
            <span className={`font-mono text-xs ${STATUS_CLS[s.status] ?? ""}`}>{s.status}</span>
            <span className="flex gap-1.5">
              {(["critical", "high", "medium", "low", "info"] as const)
                .filter((sev) => (s.findings[sev] ?? 0) > 0)
                .map((sev) => (
                  <span key={sev} className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${SEV_STYLE[sev]}`}>
                    {s.findings[sev]} {sev}
                  </span>
                ))}
              {s.status === "complete" && total === 0 && (
                <span className="rounded-full border border-accent/30 px-2 py-0.5 font-mono text-[10px] text-accent">clean</span>
              )}
            </span>
            <span className="ml-auto font-mono text-[11px] text-ink-dim">
              {fmtWhen(s.createdAt)} · {fmtDur(s.createdAt, s.finishedAt)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
