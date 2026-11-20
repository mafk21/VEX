import { numberLines } from "./packer";

/**
 * The VEX hunting prompt and the structured-output schema Gemini must follow.
 */

export interface NumberedFile {
  path: string;
  numbered: string;
  lines: number;
}

export function prepareFile(path: string, content: string): NumberedFile {
  const { text, lines } = numberLines(content);
  return { path, numbered: text, lines };
}

export const FINDINGS_RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      file: { type: "STRING", description: "Exact path from this chunk" },
      line_start: { type: "INTEGER" },
      line_end: { type: "INTEGER" },
      severity: { type: "STRING", enum: ["critical", "high", "medium", "low", "info"] },
      category: { type: "STRING", enum: ["security", "bug", "logic", "quality"] },
      title: { type: "STRING", description: "One-line summary" },
      explanation: { type: "STRING", description: "What the issue is, why it matters, how it can be triggered" },
      suggested_fix: { type: "STRING", description: "Concrete fix — code or precise instructions" },
      confidence: { type: "NUMBER", description: "0.0 to 1.0" },
    },
    required: ["file", "line_start", "severity", "category", "title", "explanation"],
  },
} as const;

export function buildScanPrompt(args: {
  repo: string;
  chunkIdx: number;
  totalChunks: number;
  inventory: string[];
  files: NumberedFile[];
  deep?: boolean;
}): string {
  const { repo, chunkIdx, totalChunks, inventory, files, deep } = args;

  const codeBlocks = files
    .map((f) => `=== FILE: ${f.path} (${f.lines} lines) ===\n${f.numbered}`)
    .join("\n\n");

  return `You are VEX, an elite security researcher and staff software engineer performing a meticulous code audit.

REPOSITORY: ${repo}
You are reviewing chunk ${chunkIdx + 1} of ${totalChunks}. The repository's filtered file inventory is listed first so you can reason about the project structure; the code you must audit follows under CODE.

FILE INVENTORY:
${inventory.map((p) => `- ${p}`).join("\n")}

WHAT TO HUNT:
- security: injection (SQL/command/template), XSS, SSRF, authn/authz bypass, IDOR / missing ownership checks on object access, mass assignment, JWT weaknesses (alg=none, weak secret, no expiry), hardcoded secrets or keys, insecure crypto, unsafe deserialization, path traversal, CSRF/CORS mistakes, open redirects, missing rate limiting on sensitive endpoints, prototype pollution, session/cookie misconfig (no HttpOnly/Secure)
- bug: null/undefined dereferences, race conditions, unhandled promise rejections, missing error handling, resource leaks, off-by-one errors, wrong operator/typo-level mistakes, integer issues
- logic: unreachable code, inverted or wrong conditionals, broken async/await flow, incorrect state transitions, early returns that skip cleanup, functions whose result is ignored when it matters
- quality: only issues with real maintenance/correctness impact (dead exports, dangerous duplication, hidden coupling) — no style nitpicks

PAY SPECIAL ATTENTION to state-changing handlers (POST/PUT/DELETE, payment, admin) that lack visible auth/authorization checks — the most common real-world break.

RULES:
1. Only report issues grounded in the code below. Never speculate about file contents you cannot see.
2. Lines are numbered as "  42 | code". Cite accurate line_start and line_end within the file you name.
3. "file" must exactly match one of the paths in this chunk.
4. severity: critical = exploitable now / data loss; high: serious but needs conditions; medium: real issue, limited blast radius; low: minor; info: worth knowing.
5. confidence is 0.0–1.0. Omit anything below 0.4.
6. suggested_fix must be concrete: corrected code or precise steps.
7. Return at most 25 findings, most severe first. Clean code → return [].
8. Output ONLY the JSON array matching the required schema.${deep ? "\n9. DEEP MODE: reason step by step before finalizing each finding — trace data flows across the files in this chunk, check callers/callees against the inventory, and double-check exploitability so severity is neither inflated nor understated." : ""}

CODE:
${codeBlocks}`;
}

/** Verification prompt: re-examine one finding against its full file. */
export function buildVerifyPrompt(args: {
  repo: string;
  path: string;
  numbered: string;
  finding: { severity: string; category: string; title: string; explanation: string };
}): string {
  const { repo, path, numbered, finding } = args;
  return `You are VEX's verification pass. An automated audit of ${repo} produced the finding below. Re-examine it against the complete file and decide if it is real and correctly rated.

FINDING:
${JSON.stringify({ file: path, severity: finding.severity, category: finding.category, title: finding.title, explanation: finding.explanation }, null, 2)}

FILE ${path}:
${numbered}

RULES:
- If the finding is NOT a real issue (wrong, not exploitable, already mitigated in this file, or speculative): return exactly [].
- If it IS real: return an array with exactly one refined finding for file "${path}" — accurate severity (do not inflate), honest confidence, corrected line_start/line_end, a sharper explanation (how it triggers, blast radius), and a concrete suggested_fix.
- Output ONLY the JSON array matching the required schema.`;
}
