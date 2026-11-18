import { redirect } from "next/navigation";
import Link from "next/link";
import { getStatus } from "@/lib/config";
import RepoGrid from "@/components/repo-grid";
import DisconnectButtons from "@/components/disconnect-buttons";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const status = getStatus();
  if (!status.github.connected || !status.gemini.connected) {
    redirect("/onboarding");
  }

  const user = status.github.user;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel text-accent">⌖</div>
          <span className="font-mono text-lg font-bold">VEX</span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/scans"
            className="rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-ink-dim transition hover:border-accent/50 hover:text-accent"
          >
            history
          </Link>
          <Link
            href="/settings"
            title="Settings & privacy"
            className="rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-ink-dim transition hover:border-accent/50 hover:text-accent"
          >
            ⚙
          </Link>
          <span className="hidden rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-ink-dim sm:inline">
            ● local-only
          </span>

          {user && (
            <span className="flex items-center gap-2 rounded-full border border-line bg-panel py-1 pr-3 pl-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
              <span className="font-mono text-xs">{user.login}</span>
            </span>
          )}

          <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 font-mono text-[11px] text-accent">
            gemini ✓
          </span>

          <DisconnectButtons />
        </div>
      </header>

      {/* Repo list */}
      <section className="mt-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold">Choose your target</h1>
            <p className="mt-1 text-sm text-ink-dim">
              Pick a repository and VEX will hunt it for bugs, vulnerabilities, and logic-flow breaks.
            </p>
          </div>
        </div>
        <RepoGrid />
      </section>
    </main>
  );
}
