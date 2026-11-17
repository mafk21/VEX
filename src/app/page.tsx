import Link from "next/link";
import { getStatus } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Home() {
  const status = getStatus();
  const ready = status.github.connected && status.gemini.connected;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      <div className="vex-grid pointer-events-none absolute inset-0" />

      <div className="relative z-10 flex max-w-2xl flex-col items-center text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-panel text-3xl text-accent shadow-[0_0_60px_rgba(46,230,168,0.15)]">
          ⌖
        </div>

        <h1 className="font-mono text-5xl font-bold tracking-tight text-ink">
          VEX
        </h1>
        <p className="mt-4 text-xl text-ink">
          The AI code hunter that <span className="text-accent">lives on your machine</span>.
        </p>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-ink-dim">
          Connect your GitHub and your own Gemini API key, pick a repo, and VEX hunts it for bugs,
          vulnerabilities, and logic-flow breaks — with file-and-line evidence and suggested fixes.
        </p>

        <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { icon: "⛨", title: "Local-first", body: "Keys & findings stay on this device. No accounts, no cloud DB, no telemetry." },
            { icon: "◫", title: "Whole-repo context", body: "Gemini's 1M-token window lets VEX trace logic across files, not just within them." },
            { icon: "⚑", title: "Actionable findings", body: "Severity, category, exact lines, and a suggested fix for everything it flags." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-line bg-panel p-4 text-left">
              <div className="text-lg text-accent">{f.icon}</div>
              <div className="mt-2 text-sm font-semibold">{f.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-ink-dim">{f.body}</div>
            </div>
          ))}
        </div>

        <Link
          href={ready ? "/dashboard" : "/onboarding"}
          className="mt-10 rounded-lg bg-accent px-8 py-3 font-mono text-sm font-bold text-accent-ink transition hover:brightness-110"
        >
          {ready ? "Open dashboard →" : "Connect & start hunting →"}
        </Link>

        <p className="mt-6 font-mono text-[11px] text-ink-dim">
          outbound traffic: your machine → github.com · your machine → generativelanguage.googleapis.com · nothing else
        </p>
      </div>
    </main>
  );
}
