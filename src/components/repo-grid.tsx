"use client";

import { useCallback, useEffect, useState } from "react";

interface Repo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  htmlUrl: string;
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5", Go: "#00ADD8",
  Rust: "#dea584", Ruby: "#701516", Java: "#b07219", C: "#9b9b9b", "C++": "#f34b7d",
  "C#": "#178600", PHP: "#4F5D95", Swift: "#F05138", Kotlin: "#A97BFF", Dart: "#00B4AB",
  HTML: "#e34c26", CSS: "#563d7c", Shell: "#89e051", Vue: "#41b883", Svelte: "#ff3e00",
};

function timeAgo(iso: string): string {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function RepoGrid() {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState<number | null>(null);
  const [startError, setStartError] = useState("");
  const [lastScans, setLastScans] = useState<Record<string, { id: string; status: string; findings: Record<string, number>; createdAt: string }>>({});

  useEffect(() => {
    fetch("/api/scans")
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        const map: Record<string, (typeof d.scans)[number]> = {};
        for (const s of d.scans) if (!map[s.repoFullName]) map[s.repoFullName] = s; // list is newest-first
        setLastScans(map);
      })
      .catch(() => {});
  }, []);

  async function startHunt(repo: Repo, mode: "quick" | "deep" = "quick") {
    setStarting(repo.id);
    setStartError("");
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoFullName: repo.fullName, mode }),
      });
      const data = await res.json();
      if (data.ok) {
        window.location.href = `/scans/${data.scanId}`;
      } else if (res.status === 409 && data.scanId) {
        window.location.href = `/scans/${data.scanId}`;
      } else {
        setStartError(data.error ?? "Failed to start the scan.");
      }
    } catch {
      setStartError("Could not reach the local VEX server.");
    } finally {
      setStarting(null);
    }
  }

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    setError("");
    try {
      const res = await fetch(refresh ? "/api/repos?refresh=1" : "/api/repos");
      const data = await res.json();
      if (data.ok) {
        setRepos(data.repos);
        setWarning(data.warning ?? "");
      } else {
        setError(data.error ?? "Failed to load repositories.");
      }
    } catch {
      setError("Could not reach the local VEX server.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const filtered = (repos ?? []).filter(
    (r) =>
      r.fullName.toLowerCase().includes(query.toLowerCase()) ||
      (r.description ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter repositories…"
          className="w-72 rounded-lg border border-line bg-panel px-4 py-2 text-sm outline-none placeholder:text-ink-dim/50 focus:border-accent/60"
        />
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="rounded-lg border border-line bg-panel px-4 py-2 font-mono text-xs text-ink-dim transition hover:border-accent/50 hover:text-accent disabled:opacity-40"
        >
          {refreshing ? "refreshing…" : "↻ refresh"}
        </button>
        {repos && (
          <span className="font-mono text-xs text-ink-dim">
            {filtered.length} / {repos.length} repos
          </span>
        )}
      </div>

      {warning && (
        <p className="mt-4 rounded-lg border border-warn/30 bg-warn/5 px-4 py-2 text-xs text-warn">⚠ {warning}</p>
      )}
      {startError && (
        <p className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-xs text-danger">✕ {startError}</p>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          ✕ {error}
          <button onClick={() => load(true)} className="ml-3 underline underline-offset-2">retry</button>
        </div>
      )}

      {!repos && !error && (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border border-line bg-panel" />
          ))}
        </div>
      )}

      {repos && filtered.length === 0 && (
        <p className="mt-10 text-center text-sm text-ink-dim">
          {repos.length === 0 ? "No repositories found for this token." : "No repositories match your filter."}
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((r) => (
          <div
            key={r.id}
            className="group flex flex-col rounded-xl border border-line bg-panel p-5 transition hover:border-accent/40"
          >
            <div className="flex items-start justify-between gap-2">
              <a
                href={r.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm font-bold text-ink group-hover:text-accent"
              >
                {r.fullName}
              </a>
              <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim">
                {r.private ? "🔒 private" : "public"}
              </span>
            </div>

            <p className="mt-2 line-clamp-2 min-h-8 text-xs leading-relaxed text-ink-dim">
              {r.description ?? "No description."}
            </p>

            <div className="mt-3 flex items-center gap-3 font-mono text-[11px] text-ink-dim">
              {r.language && (
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: LANG_COLORS[r.language] ?? "#7d8794" }}
                  />
                  {r.language}
                </span>
              )}
              <span>⑂ {r.defaultBranch}</span>
              <span className="ml-auto">{timeAgo(r.updatedAt)}</span>
            </div>

            {lastScans[r.fullName] && (
              <a
                href={`/scans/${lastScans[r.fullName].id}`}
                className="mt-3 block rounded-lg border border-line bg-panel-2 px-3 py-1.5 font-mono text-[10px] text-ink-dim transition hover:border-accent/40 hover:text-accent"
              >
                {(() => {
                  const s = lastScans[r.fullName];
                  if (["queued", "fetching", "scanning"].includes(s.status)) return `● hunt in progress — watch live →`;
                  const total = Object.values(s.findings ?? {}).reduce((a, b) => a + b, 0);
                  if (s.status === "failed") return `last hunt failed · ${timeAgo(s.createdAt)}`;
                  if (total === 0 && s.status === "complete") return `last hunt: clean ✓ · ${timeAgo(s.createdAt)}`;
                  const sev = ["critical", "high", "medium", "low", "info"].find((k) => (s.findings?.[k] ?? 0) > 0);
                  return `last hunt: ${total} findings${sev ? ` (${s.findings[sev]} ${sev})` : ""} · ${timeAgo(s.createdAt)}`;
                })()}
              </a>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => startHunt(r, "quick")}
                disabled={starting !== null}
                className="flex-1 rounded-lg border border-accent/40 bg-accent/10 py-2 font-mono text-xs font-bold text-accent transition hover:bg-accent/20 disabled:opacity-40"
              >
                {starting === r.id ? "starting…" : "⌖ hunt"}
              </button>
              <button
                onClick={() => startHunt(r, "deep")}
                disabled={starting !== null}
                title="Deep scan — Gemini Pro + extended reasoning over smaller chunks. Needs a paid-tier key."
                className="rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs text-ink-dim transition hover:border-accent/50 hover:text-accent disabled:opacity-40"
              >
                deep
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
