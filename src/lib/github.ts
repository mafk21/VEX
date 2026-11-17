import type { GitHubUserInfo } from "./config";

/**
 * GitHub REST API client. Calls are made directly from the user's machine
 * with their own Personal Access Token — nothing transits any VEX server.
 */

const API = "https://api.github.com";

export interface RepoSummary {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  htmlUrl: string;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vex-local",
  };
}

export type GitHubValidation =
  | { ok: true; user: GitHubUserInfo; scopes: string | null }
  | { ok: false; error: "invalid" | "unreachable" | "no_repo_access" | string };

export async function validateGitHubToken(token: string): Promise<GitHubValidation> {
  let res: Response;
  try {
    res = await fetch(`${API}/user`, { headers: headers(token), cache: "no-store" });
  } catch {
    return { ok: false, error: "unreachable" };
  }
  if (res.status === 401) return { ok: false, error: "invalid" };
  if (res.status === 403) return { ok: false, error: "invalid" };
  if (!res.ok) return { ok: false, error: `GitHub API returned ${res.status}` };

  const u = (await res.json()) as { login: string; avatar_url: string; name: string | null };

  // Confirm the token can actually read repositories
  let repoCheck: Response;
  try {
    repoCheck = await fetch(`${API}/user/repos?per_page=1`, { headers: headers(token), cache: "no-store" });
  } catch {
    return { ok: false, error: "unreachable" };
  }
  if (repoCheck.status === 403 || repoCheck.status === 404) {
    return { ok: false, error: "no_repo_access" };
  }

  return {
    ok: true,
    user: { login: u.login, avatarUrl: u.avatar_url, name: u.name ?? null },
    scopes: res.headers.get("x-oauth-scopes"), // present for classic PATs, null for fine-grained
  };
}

export async function listUserRepos(token: string): Promise<RepoSummary[]> {
  const repos: RepoSummary[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `${API}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      { headers: headers(token), cache: "no-store" },
    );
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const arr = (await res.json()) as Array<Record<string, unknown>>;
    for (const r of arr) {
      repos.push({
        id: r.id as number,
        name: r.name as string,
        fullName: r.full_name as string,
        description: (r.description as string) ?? null,
        language: (r.language as string) ?? null,
        private: !!r.private,
        defaultBranch: (r.default_branch as string) ?? "main",
        updatedAt: (r.pushed_at as string) ?? (r.updated_at as string) ?? "",
        htmlUrl: r.html_url as string,
      });
    }
    if (arr.length < 100) break;
  }
  return repos;
}
