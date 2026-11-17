"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DisconnectButtons() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect(kind: "github" | "gemini") {
    setBusy(true);
    await fetch(`/api/keys/${kind}`, { method: "DELETE" });
    router.push("/onboarding");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => disconnect("github")}
        disabled={busy}
        title="Delete the stored GitHub token from this machine"
        className="rounded-full border border-line px-3 py-1.5 font-mono text-[11px] text-ink-dim transition hover:border-danger/50 hover:text-danger disabled:opacity-40"
      >
        ✕ github
      </button>
      <button
        onClick={() => disconnect("gemini")}
        disabled={busy}
        title="Delete the stored Gemini key from this machine"
        className="rounded-full border border-line px-3 py-1.5 font-mono text-[11px] text-ink-dim transition hover:border-danger/50 hover:text-danger disabled:opacity-40"
      >
        ✕ gemini
      </button>
    </div>
  );
}
