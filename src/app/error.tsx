"use client";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-danger/40 bg-danger/10 text-2xl text-danger">✕</div>
      <h1 className="mt-6 text-xl font-bold">Something broke</h1>
      <p className="mt-2 font-mono text-xs leading-relaxed text-ink-dim">{error.message || "Unexpected error"}</p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg border border-accent/40 bg-accent/10 px-5 py-2 font-mono text-xs font-bold text-accent transition hover:bg-accent/20"
        >
          try again
        </button>
        <a href="/dashboard" className="rounded-lg border border-line px-5 py-2 font-mono text-xs text-ink-dim transition hover:text-ink">
          dashboard
        </a>
      </div>
    </main>
  );
}
