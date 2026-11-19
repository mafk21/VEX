"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CodeViewer from "./code-viewer";

/** The full findings report: severity summary, filters, master-detail, code context. */

export interface ReportScan {
  id: string;
  repoFullName: string;
  status: string;
  model: string | null;
  error: string | null;
  coverage: {
    files_total: number;
    files_selected: number;
    files_scanned: number;
    files_skipped: number;
    files_oversized: number;
    est_tokens: number;
  } | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Finding {
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
  status: string;
}

const STATUS_META: Record<string, { label: string; icon: string; cls: string }> = {
  open: { label: "open", icon: "○", cls: "border-line bg-panel-2 text-ink-dim" },
  confirmed: { label: "confirmed", icon: "✓", cls: "border-accent/50 bg-accent/10 text-accent" },
  false_positive: { label: "false positive", icon: "✗", cls: "border-danger/50 bg-danger/10 text-danger" },
  ignored: { label: "ignored", icon: "⊘", cls: "border-line bg-panel-2 text-ink-dim" },
};
const STATUS_ORDER = ["open", "confirmed", "false_positive", "ignored", "all"];

export const SEV_STYLE: Record<string, string> = {
  critical: "border-danger/60 bg-danger/10 text-danger",
  high: "border-orange-500/40 bg-orange-500/10 text-orange-400",
  medium: "border-warn/50 bg-warn/10 text-warn",
  low: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  info: "border-line bg-panel-2 text-ink-dim",
};

const SEV_DOT: Record<string, string> = {
  critical: "bg-danger",
  high: "bg-orange-400",
  medium: "bg-warn",
  low: "bg-sky-400",
  info: "bg-ink-dim",
};

const SEV_ORDER = ["critical", "high", "medium", "low", "info"];
const CAT_ORDER = ["all", "security", "bug", "logic", "quality"];

const CAT_ICON: Record<string, string> = {
  security: "⛨",
  bug: "🐛",
  logic: "⑂",
  quality: "✦",
};

interface Props {
  scan: ReportScan;
  findings: Finding[];
}

export default function ScanReport({ scan, findings }: Props) {
  const [sevFilter, setSevFilter] = useState<Set<string>>(new Set());
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"severity" | "confidence" | "file">("severity");
  const [selectedId, setSelectedId] = useState<number | null>(findings[0]?.id ?? null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});

  // Triage state lives in SQLite; overrides keep the UI optimistic.
  const items = useMemo(
    () => findings.map((f) => (overrides[f.id] ? { ...f, status: overrides[f.id] } : f)),
    [findings, overrides],
  );

  async function triage(id: number, status: string) {
    const prev = overrides[id];
    setOverrides((o) => ({ ...o, [id]: status }));
    try {
      const res = await fetch(`/api/findings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "triage failed");
    } catch {
      setOverrides((o) => ({ ...o, [id]: prev ?? "open" })); // revert on failure
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of items) c[f.severity] = (c[f.severity] ?? 0) + 1;
    return c;
  }, [items]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { open: 0, confirmed: 0, false_positive: 0, ignored: 0 };
    for (const f of items) c[f.status] = (c[f.status] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (statusFilter !== "all") list = list.filter((f) => f.status === statusFilter);
    if (sevFilter.size > 0) list = list.filter((f) => sevFilter.has(f.severity));
    if (catFilter !== "all") list = list.filter((f) => f.category === catFilter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((f) => f.title.toLowerCase().includes(q) || f.filePath.toLowerCase().includes(q));
    const sevRank = (s: string) => SEV_ORDER.indexOf(s);
    return [...list].sort((a, b) =>
      sort === "severity"
        ? sevRank(a.severity) - sevRank(b.severity) || (b.confidence ?? 0) - (a.confidence ?? 0)
        : sort === "confidence"
          ? (b.confidence ?? 0) - (a.confidence ?? 0)
          : a.filePath.localeCompare(b.filePath) || (a.lineStart ?? 0) - (b.lineStart ?? 0),
    );
  }, [items, sevFilter, catFilter, statusFilter, query, sort]);

  const selected = filtered.find((f) => f.id === selectedId) ?? filtered[0] ?? null;

  function toggleSev(s: string) {
    setSevFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const partial = scan.error && scan.status !== "failed";

  return (
    <div className="mt-6">
      {/* partial-failure notice */}
      {partial && (
        <p className="mb-4 rounded-lg border border-warn/30 bg-warn/5 px-4 py-2 text-sm text-warn">⚠ {scan.error}</p>
      )}

      {/* severity summary — clickable filters */}
      <div className="grid grid-cols-5 gap-2">
        {SEV_ORDER.map((s) => {
          const active = sevFilter.has(s);
          const dimmed = sevFilter.size > 0 && !active;
          return (
            <button
              key={s}
              onClick={() => toggleSev(s)}
              className={`rounded-lg border px-3 py-2 text-center transition ${SEV_STYLE[s]} ${dimmed ? "opacity-35" : ""} ${active ? "ring-1 ring-current" : ""}`}
            >
              <div className="font-mono text-lg font-bold">{counts[s] ?? 0}</div>
              <div className="font-mono text-[10px] uppercase">{s}</div>
            </button>
          );
        })}
      </div>

      {/* triage workflow bar */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-panel p-0.5">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1.5 font-mono text-[11px] transition ${
                statusFilter === s ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink"
              }`}
            >
              {s === "all" ? `all ${items.length}` : `${STATUS_META[s].icon} ${STATUS_META[s].label} ${statusCounts[s] ?? 0}`}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-[11px] text-ink-dim">
          triaged {items.length - (statusCounts.open ?? 0)}/{items.length}
        </span>
      </div>

      {/* toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-panel p-0.5">
          {CAT_ORDER.map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className={`rounded-md px-3 py-1.5 font-mono text-[11px] transition ${
                catFilter === c ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink"
              }`}
            >
              {c === "all" ? "all" : `${CAT_ICON[c]} ${c}`}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or file…"
          className="flex-1 min-w-40 rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none placeholder:text-ink-dim/50 focus:border-accent/60"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="rounded-lg border border-line bg-panel px-3 py-2 font-mono text-[11px] text-ink-dim outline-none"
        >
          <option value="severity">sort: severity</option>
          <option value="confidence">sort: confidence</option>
          <option value="file">sort: file</option>
        </select>
      </div>

      {/* master-detail */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* findings list */}
        <div className="space-y-2 lg:col-span-2 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
          {filtered.length === 0 && (
            <p className="rounded-xl border border-line bg-panel p-6 text-center text-sm text-ink-dim">
              No findings match the current filters.
            </p>
          )}
          {filtered.map((f) => (
            <button
              key={f.id}
              onClick={() => setSelectedId(f.id)}
              className={`w-full rounded-xl border p-4 text-left transition ${
                selected?.id === f.id ? "border-accent/50 bg-panel-2" : "border-line bg-panel hover:border-ink-dim/40"
              } ${f.status === "ignored" || f.status === "false_positive" ? "opacity-55" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[f.severity]}`} />
                <span className="flex-1 truncate text-sm font-medium">{f.title}</span>
                {f.status !== "open" && (
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${STATUS_META[f.status].cls}`}>
                    {STATUS_META[f.status].icon} {STATUS_META[f.status].label}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-ink-dim">
                <span className="truncate">{f.filePath}{f.lineStart ? `:${f.lineStart}` : ""}</span>
                <span className="ml-auto shrink-0 rounded border border-line px-1.5 py-0.5">{f.category}</span>
              </div>
            </button>
          ))}
        </div>

        {/* detail pane */}
        <div className="lg:col-span-3">
          {selected ? (
            <FindingDetail scan={scan} finding={selected} onTriage={triage} />
          ) : (
            <p className="rounded-xl border border-line bg-panel p-6 text-center text-sm text-ink-dim">
              Select a finding to inspect it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FindingDetail({ scan, finding, onTriage }: { scan: ReportScan; finding: Finding; onTriage: (id: number, status: string) => void }) {
  const [file, setFile] = useState<{ content: string; lines: number } | null | "loading" | "missing">("loading");
  const cacheRef = useRef(new Map<string, { content: string; lines: number } | null>());

  useEffect(() => {
    let cancelled = false;
    const path = finding.filePath;
    async function load() {
      if (cacheRef.current.has(path)) {
        if (!cancelled) setFile(cacheRef.current.get(path) ?? "missing");
        return;
      }
      setFile("loading");
      try {
        const res = await fetch(`/api/scans/${scan.id}/file?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        const val = data.ok ? { content: data.file.content as string, lines: data.file.lines as number } : null;
        cacheRef.current.set(path, val);
        if (!cancelled) setFile(val ?? "missing");
      } catch {
        cacheRef.current.set(path, null);
        if (!cancelled) setFile("missing");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [scan.id, finding.filePath]);

  const ghUrl = `https://github.com/${scan.repoFullName}/blob/HEAD/${finding.filePath}${
    finding.lineStart ? `#L${finding.lineStart}${finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-L${finding.lineEnd}` : ""}` : ""
  }`;

  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="border-b border-line p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase ${SEV_STYLE[finding.severity]}`}>
            {finding.severity}
          </span>
          <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[10px] text-ink-dim">
            {CAT_ICON[finding.category]} {finding.category}
          </span>
          {finding.confidence !== null && (
            <span className="font-mono text-[10px] text-ink-dim">{(finding.confidence * 100).toFixed(0)}% confidence</span>
          )}
        </div>
        <h2 className="mt-2.5 text-base font-bold">{finding.title}</h2>
        <a href={ghUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-xs text-accent hover:underline underline-offset-2">
          {finding.filePath}
          {finding.lineStart ? `:${finding.lineStart}${finding.lineEnd && finding.lineEnd !== finding.lineStart ? `–${finding.lineEnd}` : ""}` : ""} ↗
        </a>

        {/* triage actions — the workflow: work the list, mark what you decide */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(["confirmed", "false_positive", "ignored"] as const).map((s) => {
            const active = finding.status === s;
            return (
              <button
                key={s}
                onClick={() => onTriage(finding.id, active ? "open" : s)}
                className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] transition ${
                  active ? `${STATUS_META[s].cls} ring-1 ring-current` : "border-line bg-panel-2 text-ink-dim hover:text-ink"
                }`}
              >
                {STATUS_META[s].icon} {active ? `${STATUS_META[s].label} ✓` : STATUS_META[s].label}
              </button>
            );
          })}
          <span className="ml-auto font-mono text-[10px] text-ink-dim">
            status: {STATUS_META[finding.status]?.label ?? finding.status}
          </span>
        </div>
      </div>

      <div className="p-5">
        <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim">what vex found</h3>
        <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-ink">{finding.explanation}</p>

        {finding.suggestedFix && (
          <div className="mt-5">
            <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent">suggested fix</h3>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-accent/20 bg-accent/5 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {finding.suggestedFix}
            </pre>
          </div>
        )}

        <div className="mt-5">
          <h3 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim">code context</h3>
          {file === "loading" && <div className="h-40 animate-pulse rounded-lg border border-line bg-panel-2" />}
          {file === "missing" && (
            <p className="rounded-lg border border-line bg-panel-2 p-4 text-xs text-ink-dim">
              Source for this file wasn't captured during the scan.
            </p>
          )}
          {file !== "loading" && file !== "missing" && file && (
            <CodeViewer
              code={file.content}
              filePath={finding.filePath}
              highlightStart={finding.lineStart}
              highlightEnd={finding.lineEnd}
            />
          )}
        </div>
      </div>
    </div>
  );
}
