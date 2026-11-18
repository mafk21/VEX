import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
      <div className="font-mono text-5xl font-bold text-ink-dim">404</div>
      <p className="mt-4 text-sm text-ink-dim">This page wandered off the hunting ground.</p>
      <Link href="/dashboard" className="mt-6 rounded-lg border border-accent/40 bg-accent/10 px-5 py-2 font-mono text-xs font-bold text-accent transition hover:bg-accent/20">
        ← dashboard
      </Link>
    </main>
  );
}
