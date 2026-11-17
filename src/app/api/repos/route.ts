import { NextRequest, NextResponse } from "next/server";
import { getGitHubToken } from "@/lib/config";
import { listUserRepos } from "@/lib/github";
import { cacheRepos, getCachedRepos } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * List the user's repos. Serves the local SQLite cache when present unless
 * ?refresh=1 is passed; on GitHub failure, falls back to cache with a warning.
 */
export async function GET(req: NextRequest) {
  const token = getGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "GitHub is not connected." }, { status: 401 });
  }

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (!refresh) {
    const cached = getCachedRepos();
    if (cached.length > 0) return NextResponse.json({ ok: true, repos: cached, cached: true });
  }

  try {
    const repos = await listUserRepos(token);
    cacheRepos(repos);
    return NextResponse.json({ ok: true, repos, cached: false });
  } catch (e) {
    const cached = getCachedRepos();
    if (cached.length > 0) {
      return NextResponse.json({
        ok: true,
        repos: cached,
        cached: true,
        warning: "GitHub is unreachable — showing the cached repo list.",
      });
    }
    const msg = e instanceof Error ? e.message : "Failed to load repositories.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
