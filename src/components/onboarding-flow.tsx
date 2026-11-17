"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Status {
  github: { connected: boolean; user: { login: string; avatarUrl: string } | null };
  gemini: { connected: boolean; models: string[] };
}

type ConnState = "idle" | "checking" | "ok" | "error";

export default function OnboardingFlow() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);

  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [ghState, setGhState] = useState<ConnState>("idle");
  const [ghError, setGhError] = useState("");

  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [gemState, setGemState] = useState<ConnState>("idle");
  const [gemError, setGemError] = useState("");
  const [gemModels, setGemModels] = useState<{ flash: string[]; pro: string[] } | null>(null);
  const [disclosure, setDisclosure] = useState(false);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ github: { connected: false, user: null }, gemini: { connected: false, models: [] } }));
  }, []);

  const ghConnected = status?.github.connected ?? false;
  const gemConnected = status?.gemini.connected ?? false;
  const ready = ghConnected && gemConnected;

  async function connectGitHub() {
    setGhState("checking");
    setGhError("");
    const res = await fetch("/api/keys/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (data.ok) {
      setGhState("ok");
      setToken("");
      const s = await fetch("/api/status").then((r) => r.json());
      setStatus(s);
    } else {
      setGhState("error");
      setGhError(data.error ?? "Something went wrong.");
    }
  }

  async function connectGemini() {
    setGemState("checking");
    setGemError("");
    const res = await fetch("/api/keys/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();
    if (data.ok) {
      setGemState("ok");
      setGemModels(data.models);
      setKey("");
      const s = await fetch("/api/status").then((r) => r.json());
      setStatus(s);
    } else {
      setGemState("error");
      setGemError(data.error ?? "Something went wrong.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-12">
      <Link href="/" className="mb-10 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel text-accent">⌖</div>
        <span className="font-mono text-lg font-bold">VEX</span>
        <span className="font-mono text-xs text-ink-dim">/ setup</span>
      </Link>

      <h1 className="text-2xl font-bold">Connect your accounts</h1>
      <p className="mt-2 text-sm text-ink-dim">
        Both credentials are validated live from this machine, encrypted, and stored locally in{" "}
        <code className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-accent">.vex/config.json</code>{" "}
        (permissions <code className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-accent">0600</code>).
        They are never sent anywhere except their own APIs.
      </p>

      {/* ── Step 1: GitHub ─────────────────────────────────────────── */}
      <section className="mt-8 rounded-xl border border-line bg-panel p-6">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-3 font-mono text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-xs text-accent">1</span>
            GITHUB ACCESS TOKEN
          </h2>
          {ghConnected && (
            <span className="rounded-full bg-accent/10 px-3 py-1 font-mono text-xs text-accent">
              ✓ {status?.github.user?.login}
            </span>
          )}
        </div>

        {ghConnected ? (
          <p className="mt-3 text-sm text-ink-dim">
            Connected{status?.github.user ? ` as ${status.github.user.login}` : ""}. VEX can now list and read your repositories.
          </p>
        ) : (
          <>
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink-dim">
              <li>
                Open{" "}
                <a className="text-accent underline underline-offset-2" href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer">
                  github.com/settings/tokens
                </a>{" "}
                → <span className="text-ink">Generate new token</span> (fine-grained)
              </li>
              <li>Repository access: <span className="text-ink">All repositories</span> (or pick the ones you want scanned)</li>
              <li>
                Permissions → <span className="text-ink">Contents: Read-only</span> — that&apos;s all VEX needs
              </li>
              <li>Generate and paste the token below</li>
            </ol>
            <div className="mt-4 flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="github_pat_…"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded-lg border border-line bg-void px-4 py-2.5 pr-16 font-mono text-sm outline-none placeholder:text-ink-dim/50 focus:border-accent/60"
                />
                <button
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-ink-dim hover:text-ink"
                >
                  {showToken ? "hide" : "show"}
                </button>
              </div>
              <button
                onClick={connectGitHub}
                disabled={!token || ghState === "checking"}
                className="rounded-lg bg-accent px-5 py-2.5 font-mono text-sm font-bold text-accent-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {ghState === "checking" ? "Checking…" : "Connect"}
              </button>
            </div>
            {ghState === "error" && <p className="mt-3 text-sm text-danger">✕ {ghError}</p>}
          </>
        )}
      </section>

      {/* ── Step 2: Gemini ─────────────────────────────────────────── */}
      <section className="mt-6 rounded-xl border border-line bg-panel p-6">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-3 font-mono text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-xs text-accent">2</span>
            GEMINI API KEY
          </h2>
          {gemConnected && (
            <span className="rounded-full bg-accent/10 px-3 py-1 font-mono text-xs text-accent">✓ connected</span>
          )}
        </div>

        {gemConnected ? (
          <p className="mt-3 text-sm text-ink-dim">
            Key stored. {status?.gemini.models.length ? `${status.gemini.models.length} models available to this key.` : ""}
          </p>
        ) : (
          <>
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink-dim">
              <li>
                Open{" "}
                <a className="text-accent underline underline-offset-2" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                  aistudio.google.com/apikey
                </a>{" "}
                → <span className="text-ink">Create API key</span> — the free tier works
              </li>
              <li>Paste the key below</li>
            </ol>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-warn/30 bg-warn/5 p-4">
              <input
                type="checkbox"
                checked={disclosure}
                onChange={(e) => setDisclosure(e.target.checked)}
                className="mt-0.5 accent-emerald-400"
              />
              <span className="text-xs leading-relaxed text-ink-dim">
                <span className="font-semibold text-warn">Privacy note:</span> during a scan, your code travels
                directly from this machine to Google&apos;s Gemini API. Free-tier keys may let Google use prompts
                for training. For private or sensitive repos, use a paid-tier key — Google does not train on
                paid API traffic. I understand and accept.
              </span>
            </label>

            <div className="mt-4 flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? "text" : "password"}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="AIza…"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded-lg border border-line bg-void px-4 py-2.5 pr-16 font-mono text-sm outline-none placeholder:text-ink-dim/50 focus:border-accent/60"
                />
                <button
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-ink-dim hover:text-ink"
                >
                  {showKey ? "hide" : "show"}
                </button>
              </div>
              <button
                onClick={connectGemini}
                disabled={!key || !disclosure || gemState === "checking"}
                className="rounded-lg bg-accent px-5 py-2.5 font-mono text-sm font-bold text-accent-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {gemState === "checking" ? "Checking…" : "Connect"}
              </button>
            </div>
            {gemState === "error" && <p className="mt-3 text-sm text-danger">✕ {gemError}</p>}
            {gemState === "ok" && gemModels && (
              <p className="mt-3 font-mono text-xs text-accent">
                ✓ key valid — {gemModels.flash.length} flash · {gemModels.pro.length} pro models available
              </p>
            )}
          </>
        )}
      </section>

      <button
        onClick={() => router.push("/dashboard")}
        disabled={!ready}
        className="mt-8 w-full rounded-lg border border-accent/40 bg-accent/10 px-6 py-3.5 font-mono text-sm font-bold text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-30"
      >
        {ready ? "Enter the hunting ground →" : "Connect both accounts to continue"}
      </button>
    </main>
  );
}
