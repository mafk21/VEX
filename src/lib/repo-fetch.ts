import type { TreeEntry } from "./filter";

/**
 * GitHub repo content fetching: file trees (with fallback for huge repos)
 * and raw file contents. All calls go directly from the user's machine.
 */

const API = "https://api.github.com";

function headers(token: string, accept = "application/vnd.github+json"): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vex-local",
  };
}

interface GitTreeNode {
  path: string;
  type: "blob" | "tree" | string;
  size?: number;
  sha: string;
}

export interface RepoTree {
  entries: TreeEntry[];
  truncated: boolean;
}

async function fetchTreeNode(token: string, fullName: string, ref: string): Promise<{ tree: GitTreeNode[]; truncated: boolean }> {
  const res = await fetch(`${API}/repos/${fullName}/git/trees/${encodeURIComponent(ref)}?recursive=1`, {
    headers: headers(token),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub tree fetch failed: ${res.status}`);
  return (await res.json()) as { tree: GitTreeNode[]; truncated: boolean };
}

/** Recursive tree with BFS fallback when GitHub truncates very large repos. */
export async function fetchRepoTree(token: string, fullName: string, branch: string): Promise<RepoTree> {
  const root = await fetchTreeNode(token, fullName, branch);
  if (!root.truncated) {
    return {
      entries: root.tree.filter((n) => n.type === "blob").map((n) => ({ path: n.path, size: n.size ?? 0 })),
      truncated: false,
    };
  }

  // BFS over subtrees for repos too large for a single recursive fetch
  const entries: TreeEntry[] = [];
  const queue: string[] = [branch];
  let truncated = false;
  while (queue.length > 0 && queue.length < 500) {
    const ref = queue.shift()!;
    const res = await fetch(`${API}/repos/${fullName}/git/trees/${encodeURIComponent(ref)}`, {
      headers: headers(token),
      cache: "no-store",
    });
    if (!res.ok) continue;
    const node = (await res.json()) as { tree: GitTreeNode[]; truncated: boolean };
    if (node.truncated) truncated = true;
    for (const n of node.tree) {
      if (n.type === "blob") entries.push({ path: n.path, size: n.size ?? 0 });
      else if (n.type === "tree") queue.push(n.sha);
    }
  }
  return { entries, truncated: true };
}

/** Fetch one file's raw content; returns null for binary/too-large/failed fetches. */
export async function fetchFileContent(
  token: string,
  fullName: string,
  path: string,
  branch: string,
  maxBytes: number,
): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${API}/repos/${fullName}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`, {
      headers: headers(token, "application/vnd.github.raw+json"),
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;

  const text = Buffer.from(buf).toString("utf8");
  // crude binary sniff: NUL bytes shouldn't appear in source text
  if (text.includes("\0")) return null;
  return text;
}
