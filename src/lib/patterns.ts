/**
 * Deterministic high-signal detectors: regex rules for secrets and dangerous
 * API patterns. These run locally with zero Gemini quota cost and no
 * hallucination risk — they complement (never replace) the LLM analysis.
 */

export interface PatternFinding {
  file: string;
  line_start: number;
  line_end: number;
  severity: string;
  category: string;
  title: string;
  explanation: string;
  suggested_fix: string;
  confidence: number;
}

interface Rule {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium";
  re: RegExp;
  explanation: string;
  fix: string;
  /** If set, only files matching this extension pattern are scanned. */
  exts?: RegExp;
  /** Extra check on (line, match) — return false to suppress. */
  guard?: (line: string, match: RegExpExecArray) => boolean;
}

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|php|cs|env|ya?ml|toml|ini|cfg|conf)$/i;
const SCRIPT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|php)$/i;
const WEB_EXT = /\.(ts|tsx|js|jsx|html|vue|svelte)$/i;
const PY_EXT = /\.py$/i;
const JS_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

/** Values that are obviously placeholders, not real secrets. */
const PLACEHOLDER = /^(your[-_ ]?|xxx+|changeme|change[-_ ]?me|example|sample|dummy|placeholder|none|null|todo|test|fake|dummy|redacted|\*+|<|\$\{|process\.env|import\.meta|%)/i;

const RULES: Rule[] = [
  {
    id: "aws-access-key",
    title: "Hardcoded AWS access key",
    severity: "critical",
    re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
    explanation: "An AWS access key ID is committed in source. Anyone with repo access can use it against your AWS account.",
    fix: "Rotate the key immediately in IAM, remove it from the file (and git history), and load it from an environment variable or secrets manager.",
  },
  {
    id: "github-token",
    title: "Hardcoded GitHub token",
    severity: "critical",
    re: /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{22,}|gho_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,})\b/,
    explanation: "A GitHub personal access token is committed in source. It grants API access as its owner.",
    fix: "Revoke the token in GitHub settings, remove it from source and git history, and read it from an environment variable.",
  },
  {
    id: "google-api-key",
    title: "Hardcoded Google API key",
    severity: "critical",
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
    explanation: "A Google API key is committed in source.",
    fix: "Restrict or rotate the key in Google Cloud Console and load it from an environment variable.",
  },
  {
    id: "slack-token",
    title: "Hardcoded Slack token",
    severity: "critical",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    explanation: "A Slack token is committed in source.",
    fix: "Revoke the token in your Slack app settings and load it from an environment variable.",
  },
  {
    id: "private-key",
    title: "Private key material committed",
    severity: "critical",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/,
    explanation: "A private key is committed in the repository. Anyone with read access owns whatever it protects.",
    fix: "Remove the key from source and git history, revoke/rotate it, and store keys outside the repo.",
  },
  {
    id: "jwt-literal",
    title: "Hardcoded JWT",
    severity: "high",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    explanation: "A signed JWT is committed in source. If it's a real token it may still be valid and grants its claims to anyone who finds it.",
    fix: "Revoke/expire the token and never store credentials in source. If it's a test fixture, use an obviously invalid one.",
  },
  {
    id: "generic-secret",
    title: "Hardcoded secret in assignment",
    severity: "high",
    re: /(?:api[_-]?key|api[_-]?secret|secret|passwd|password|auth[_-]?token|access[_-]?token|client[_-]?secret|jwt[_-]?secret|session[_-]?secret)\s*[:=]\s*["'`]([A-Za-z0-9/+=_\-!@#$%^&*]{12,})["'`]/i,
    explanation: "A secret-looking string is assigned directly in source code.",
    fix: "Move the secret to an environment variable or secrets manager, and rotate it if the repo was ever shared.",
    guard: (line, m) => !PLACEHOLDER.test(m[1] ?? "") && !/process\.env|import\.meta\.env|os\.environ/.test(m[1] ?? ""),
  },
  {
    id: "eval",
    title: "eval() on dynamic input",
    severity: "medium",
    re: /\beval\s*\(/,
    exts: SCRIPT_EXT,
    explanation: "eval() executes a string as code — if any part of that string is attacker-influenced this is remote code execution.",
    fix: "Replace eval with a parser (JSON.parse), a lookup table, or explicit dispatch. Never eval user-influenced strings.",
    guard: (line) => !/^\s*(\/\/|\*|#)/.test(line),
  },
  {
    id: "exec-template",
    title: "Shell command built with string interpolation",
    severity: "high",
    re: /\bexec(?:Sync)?\s*\(\s*[`"'][^)]*\$\{/,
    exts: JS_EXT,
    explanation: "A shell command is built with template/string interpolation. If any interpolated value is user-controlled, this is command injection.",
    fix: "Use execFile/spawn with an argument array (no shell), and strictly validate any user-supplied values.",
  },
  {
    id: "sql-template",
    title: "SQL query built with string interpolation",
    severity: "high",
    re: /\b(?:query|execute|raw)\s*\(\s*[`"'][^)]*\$\{/,
    exts: JS_EXT,
    explanation: "A SQL query interpolates values into the query string — classic SQL injection if any value is user-controlled.",
    fix: "Use parameterized queries / prepared statements: db.query('SELECT ... WHERE id = ?', [id]).",
  },
  {
    id: "inner-html",
    title: "innerHTML assignment (XSS risk)",
    severity: "medium",
    re: /\.innerHTML\s*=/,
    exts: WEB_EXT,
    explanation: "Assigning to innerHTML parses the value as HTML — unsanitized user content becomes stored/reflected XSS.",
    fix: "Use textContent for text, or sanitize with DOMPurify before assigning HTML.",
  },
  {
    id: "dangerously-set-html",
    title: "dangerouslySetInnerHTML usage",
    severity: "medium",
    re: /dangerouslySetInnerHTML/,
    exts: /\.(tsx|jsx)$/i,
    explanation: "dangerouslySetInnerHTML bypasses React's escaping. Safe only if the content is sanitized first.",
    fix: "Sanitize with DOMPurify, or render as text/components instead.",
  },
  {
    id: "pickle-loads",
    title: "Unsafe deserialization (pickle.loads)",
    severity: "high",
    re: /\bpickle\.loads?\s*\(/,
    exts: PY_EXT,
    explanation: "pickle deserializes arbitrary Python objects — loading untrusted data is remote code execution.",
    fix: "Use JSON or a safe format for untrusted data; only unpickle data you produced and protected yourself.",
  },
  {
    id: "yaml-load-unsafe",
    title: "yaml.load without SafeLoader",
    severity: "high",
    re: /\byaml\.load\s*\(/,
    exts: PY_EXT,
    explanation: "yaml.load without Loader=SafeLoader can construct arbitrary Python objects — code execution on untrusted YAML.",
    fix: "Use yaml.safe_load(...) or yaml.load(..., Loader=yaml.SafeLoader).",
    guard: (line) => !/SafeLoader|safe_load/.test(line),
  },
  {
    id: "cors-wildcard",
    title: "CORS allows any origin",
    severity: "medium",
    re: /(?:Access-Control-Allow-Origin["']?\s*[:,]|origin\s*[:=])\s*["'`]\*["'`]/i,
    explanation: "A wildcard CORS origin lets any website call this API from a victim's browser.",
    fix: "Allow-list the specific origins that need access; never use '*' with credentials.",
  },
  {
    id: "weak-random-token",
    title: "Security value from Math.random()",
    severity: "medium",
    re: /Math\.random\s*\(/,
    exts: JS_EXT,
    explanation: "Math.random() is not cryptographically secure — tokens/IDs derived from it are predictable.",
    fix: "Use crypto.randomBytes() / crypto.randomUUID() for tokens, sessions, and secrets.",
    guard: (line) => /token|secret|key|password|session|uuid|nonce|salt|auth/i.test(line),
  },
  {
    id: "weak-hash-password",
    title: "Weak hash for credential material",
    severity: "high",
    re: /\b(md5|sha1)\s*\(/i,
    exts: SCRIPT_EXT,
    explanation: "MD5/SHA1 are fast, broken hashes — unsuitable for passwords or tokens (trivially brute-forced/rainbow-tabled).",
    fix: "Use bcrypt, scrypt, or argon2 for passwords; HMAC-SHA256+ for tokens.",
    guard: (line, m) => /pass|pwd|secret|token|cred/i.test(line) || /pass|pwd|secret|token|cred/i.test(line.slice(0, m.index ?? 0)),
  },
  {
    id: "debug-enabled",
    title: "Debug mode enabled",
    severity: "medium",
    re: /\bdebug\s*[:=]\s*(?:true|True)\b/,
    exts: SCRIPT_EXT,
    explanation: "Debug mode leaks stack traces, internals, and sometimes an interactive console to attackers in production.",
    fix: "Gate debug mode behind an environment flag that is off in production.",
  },
];

/**
 * Scan one file's content with every applicable rule. Returns grounded
 * findings (line numbers relative to the file). Pure & testable.
 */
export function scanFileForPatterns(path: string, content: string): PatternFinding[] {
  const out: PatternFinding[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 600) continue; // minified/generated — the filter should have skipped it anyway
    for (const rule of RULES) {
      if (rule.exts && !rule.exts.test(path)) continue;
      rule.re.lastIndex = 0;
      const m = rule.re.exec(line);
      if (!m) continue;
      if (rule.guard && !rule.guard(line, m)) continue;
      out.push({
        file: path,
        line_start: i + 1,
        line_end: i + 1,
        severity: rule.severity,
        category: "security",
        title: rule.title,
        explanation: `${rule.explanation}\n\nMatched on this line: \`${line.trim().slice(0, 160)}\``,
        suggested_fix: rule.fix,
        confidence: 0.9,
      });
      break; // one finding per line is enough
    }
    if (out.length >= 50) break; // per-file noise cap
  }
  return out;
}
