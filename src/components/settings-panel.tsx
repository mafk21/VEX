"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Status {
  github: { connected: boolean; user: { login: string; avatarUrl: string } | null; connectedAt: string | null };
  gemini: { connected: boolean; models: string[]; connectedAt: string | null };
}

export default function SettingsPanel() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  async function disconnect(kind: "github" | "gemini") {
    setBusy(true);
    await fetch(`/api/keys/${kind}`, { method: "DELETE" });
    const s = await fetch("/api/status").then((r) => r.json());
    setStatus(s);
    setBusy(false);
  }

  async function wipeAll() {
    setBusy(true);
    await fetch("/api/data", { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      {/* connections */}
      <section className="rounded-xl border border-line bg-panel p-6">
        <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-ink-dim">Connections</h2>

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-line bg-panel-2 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className={`h-2 w-2 rounded-full ${status?.github.connected ? "bg-accent" : "bg-danger"}`} />
              <span className="text-sm">GitHub</span>
              {status?.github.user && <span className="font-mono text-xs text-ink-dim">{status.github.user.login}</span>}
            </div>
            {status?.github.connected && (
              <button onClick={() => disconnect("github")} disabled={busy} className="font-mono text-xs text-ink-dim hover:text-danger disabled:opacity-40">
                disconnect
              </button>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-line bg-panel-2 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className={`h-2 w-2 rounded-full ${status?.gemini.connected ? "bg-accent" : "bg-danger"}`} />
              <span className="text-sm">Gemini API key</span>
              {status?.gemini.connected && (
                <span className="font-mono text-xs text-ink-dim">{status.gemini.models.length} models</span>
              )}
            </div>
            {status?.gemini.connected && (
              <button onClick={() => disconnect("gemini")} disabled={busy} className="font-mono text-xs text-ink-dim hover:text-danger disabled:opacity-40">
                disconnect
              </button>
            )}
          </div>
        </div>

        <p className="mt-4 text-xs text-ink-dim">
          To rotate a key: disconnect it here, then{" "}
          <Link href="/onboarding" className="text-accent hover:underline underline-offset-2">reconnect via setup</Link>.
        </p>
      </section>

      {/* data */}
      <section className="rounded-xl border border-line bg-panel p-6">
        <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-ink-dim">Your data</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-dim">
          Everything VEX knows lives in <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-accent">.vex/</code>{" "}
          on this machine: your two keys (encrypted) and a SQLite database of scans and findings. Nothing is synced anywhere.
        </p>
      </section>

      {/* danger zone */}
      <section className="rounded-xl border border-danger/40 bg-danger/5 p-6">
        <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-danger">Danger zone</h2>
        <p className="mt-3 text-sm text-ink-dim">
          Permanently delete both API keys and the entire local scan history from this machine. This cannot be undone.
        </p>
        {confirmWipe ? (
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={wipeAll}
              disabled={busy}
              className="rounded-lg bg-danger px-4 py-2 font-mono text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              yes, delete everything
            </button>
            <button onClick={() => setConfirmWipe(false)} className="font-mono text-xs text-ink-dim hover:text-ink">
              cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmWipe(true)}
            className="mt-4 rounded-lg border border-danger/50 px-4 py-2 font-mono text-xs text-danger transition hover:bg-danger/10"
          >
            delete all my data…
          </button>
        )}
      </section>
    </div>
  );
}
