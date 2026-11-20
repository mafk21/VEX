import type { SelectedFile } from "./filter";

/**
 * Token-budget packer: groups selected files into chunks that fit a token
 * budget, so each Gemini call carries as much related context as possible.
 */

export const CHUNK_TOKEN_BUDGET = 60_000; // sized so 3 chunks/min stay under the 250K TPM free tier
const CHARS_PER_TOKEN = 4;

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export interface ChunkPlan {
  idx: number;
  files: SelectedFile[];
  estTokens: number;
}

export function planChunks(files: SelectedFile[], budget = CHUNK_TOKEN_BUDGET): ChunkPlan[] {
  // Affinity packing: group files by directory so related code (callers,
  // callees, sibling modules) is analyzed in the same chunk — this attacks
  // the cross-file blind spot of chunked analysis.
  const sorted = [...files].sort((a, b) => {
    const da = a.path.slice(0, Math.max(0, a.path.lastIndexOf("/")));
    const db = b.path.slice(0, Math.max(0, b.path.lastIndexOf("/")));
    return da.localeCompare(db) || a.path.localeCompare(b.path);
  });

  const chunks: ChunkPlan[] = [];
  let current: SelectedFile[] = [];
  let currentTokens = 0;

  for (const f of sorted) {
    const t = estimateTokens(f.size) + 30; // + header/formatting overhead
    if (current.length > 0 && currentTokens + t > budget) {
      chunks.push({ idx: chunks.length, files: current, estTokens: currentTokens });
      current = [];
      currentTokens = 0;
    }
    current.push(f);
    currentTokens += t;
  }
  if (current.length > 0) {
    chunks.push({ idx: chunks.length, files: current, estTokens: currentTokens });
  }
  return chunks;
}

/** Prepend line numbers so the model can cite accurate locations. */
export function numberLines(content: string): { text: string; lines: number } {
  const arr = content.split("\n");
  const width = String(arr.length).length;
  const text = arr.map((line, i) => `${String(i + 1).padStart(width, " ")} | ${line}`).join("\n");
  return { text, lines: arr.length };
}
