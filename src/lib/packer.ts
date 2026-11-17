import type { SelectedFile } from "./filter";

/**
 * Token-budget packer: groups selected files into chunks that fit a token
 * budget, so each Gemini call carries as much related context as possible.
 */

export const CHUNK_TOKEN_BUDGET = 120_000; // ~480KB of code per Gemini call
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
  const chunks: ChunkPlan[] = [];
  let current: SelectedFile[] = [];
  let currentTokens = 0;

  for (const f of files) {
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
