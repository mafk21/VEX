import Link from "next/link";
import SettingsPanel from "@/components/settings-panel";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-8">
      <div className="flex items-center justify-between border-b border-line pb-6">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel text-accent">⌖</div>
          <span className="font-mono text-lg font-bold">VEX</span>
        </Link>
        <Link href="/dashboard" className="font-mono text-xs text-ink-dim hover:text-accent">← dashboard</Link>
      </div>
      <h1 className="mt-8 text-xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-ink-dim">Connections, data, and privacy controls.</p>
      <SettingsPanel />
    </main>
  );
}
