import { NextRequest, NextResponse } from "next/server";
import { validateGitHubToken } from "@/lib/github";
import { saveGitHub, clearKey } from "@/lib/config";
import { clearCachedRepos } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Validate a GitHub PAT (live call from this machine) and store it encrypted locally. */
export async function POST(req: NextRequest) {
  let body: { token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ ok: false, error: "Paste your token first." }, { status: 400 });
  }

  const result = await validateGitHubToken(token);
  if (!result.ok) {
    const msg =
      result.error === "invalid"
        ? "GitHub rejected this token. Check that you pasted it correctly and that it hasn't expired."
        : result.error === "unreachable"
          ? "Could not reach api.github.com from this machine. Check your internet connection."
          : result.error === "no_repo_access"
            ? "Token is valid but can't read repositories. Grant Contents: read (fine-grained) or the repo scope (classic)."
            : result.error;
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  saveGitHub(token, result.user);
  return NextResponse.json({ ok: true, user: result.user });
}

/** Disconnect = delete the token from local storage and wipe the repo cache. */
export function DELETE() {
  clearKey("github");
  clearCachedRepos();
  return NextResponse.json({ ok: true });
}
