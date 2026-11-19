/**
 * Gemini API client. Calls are made directly from the user's machine with
 * their own API key (BYOK) — nothing transits any VEX server.
 *
 * Model landscape (Nov 2026): Google deprecated gemini-2.5-flash / 2.5-pro and
 * closed them to keys that hadn't used them before 2026-09-18 (calls 404 for
 * new keys; on 2026-12-01 they auto-route to 3.5-flash-lite / 3.8-flash).
 * VEX therefore discovers the key's model list at scan start, ranks current
 * models first, and probes a candidate before burning a scan on it.
 */

const API = "https://generativelanguage.googleapis.com/v1beta";

/** Quick hunts default to Flash-Lite: the only model with a usable free tier (~15 RPM / ~500 RPD). */
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
/** Deep scans default to the strongest reasoning Flash (free tier is only ~5 RPM / ~20 RPD — paid key recommended). */
export const DEFAULT_DEEP_MODEL = "gemini-3.8-flash";

export type GeminiValidation =
  | { ok: true; models: string[] }
  | { ok: false; error: "invalid" | "unreachable" | string };

export async function validateGeminiKey(key: string): Promise<GeminiValidation> {
  let res: Response;
  try {
    res = await fetch(`${API}/models?pageSize=200`, {
      headers: { "x-goog-api-key": key },
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "unreachable" };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return { ok: false, error: "invalid" };
  }
  if (!res.ok) return { ok: false, error: `Gemini API returned ${res.status}` };

  const data = (await res.json()) as {
    models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
  };
  const models = (data.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .sort();
  return { ok: true, models };
}

/** Split a model list into scan-relevant families for display / mode selection. */
export function summarizeModels(models: string[]): { flash: string[]; pro: string[] } {
  return {
    flash: models.filter((m) => m.includes("flash")),
    pro: models.filter((m) => m.includes("pro")),
  };
}

/* ── model selection ─────────────────────────────────────────────────────── */

function uniq(list: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of list) {
    if (m && !seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

/**
 * Ordered quick-hunt candidates for this key's model list. Current (3.x) models
 * first — Google's list endpoint still returns deprecated 2.5 models that new
 * keys cannot actually call, so 2.x is only a last resort for legacy keys.
 */
export function quickCandidates(models: string[]): string[] {
  if (models.length === 0) return [DEFAULT_MODEL];
  const has = (m: string) => models.includes(m);
  const gen3 = models.filter((m) => /^gemini-3/.test(m));
  return uniq([
    has("gemini-3.5-flash-lite") ? "gemini-3.5-flash-lite" : undefined,
    has("gemini-3.1-flash-lite") ? "gemini-3.1-flash-lite" : undefined,
    ...gen3.filter((m) => m.includes("flash-lite")),
    has("gemini-3.8-flash") ? "gemini-3.8-flash" : undefined,
    ...gen3.filter((m) => m.includes("flash")),
    // legacy — only callable by keys that used these models before 2026-09-18
    has("gemini-2.5-flash") ? "gemini-2.5-flash" : undefined,
    has("gemini-2.5-flash-lite") ? "gemini-2.5-flash-lite" : undefined,
    ...models.filter((m) => m.includes("flash")),
    models[0],
  ]);
}

/** Ordered deep-hunt candidates: strongest reasoning models first. */
export function deepCandidates(models: string[]): string[] {
  if (models.length === 0) return [DEFAULT_DEEP_MODEL];
  const has = (m: string) => models.includes(m);
  const gen3 = models.filter((m) => /^gemini-3/.test(m));
  return uniq([
    has("gemini-3.8-flash") ? "gemini-3.8-flash" : undefined,
    ...models.filter((m) => m.includes("pro") && !/preview|exp|latest/.test(m)),
    ...gen3.filter((m) => m.includes("flash") && !m.includes("lite")),
    ...models.filter((m) => m.includes("pro")),
    ...gen3.filter((m) => m.includes("flash-lite")),
    ...models.filter((m) => m.includes("flash")),
    models[0],
  ]);
}

/** Best quick-hunt model for this key. */
export function pickModel(models: string[]): string {
  return quickCandidates(models)[0] ?? DEFAULT_MODEL;
}

/** Best deep-hunt model for this key. */
export function pickDeepModel(models: string[]): string {
  return deepCandidates(models)[0] ?? DEFAULT_DEEP_MODEL;
}

/* ── request shape ───────────────────────────────────────────────────────── */

/** Gemini 3+ removed temperature/top_p/top_k and replaced thinking_budget with thinking_level. */
export function isGemini3Plus(model: string): boolean {
  const m = model.match(/^gemini-(\d+)/);
  return m !== null && Number(m[1]) >= 3;
}

/**
 * Build a generationConfig valid for the target model's API generation.
 * Exported for tests. Pass `schema: null` for a plain-text probe call.
 */
export function buildGenerationConfig(
  model: string,
  schema: unknown,
  opts: { thinking?: "high" | "low"; maxOutputTokens?: number } = {},
): Record<string, unknown> {
  const cfg: Record<string, unknown> = { maxOutputTokens: opts.maxOutputTokens ?? 16384 };
  if (schema) {
    cfg.responseMimeType = "application/json";
    cfg.responseSchema = schema;
  }
  if (isGemini3Plus(model)) {
    // No sampling params on 3.x — reasoning depth is the dial. MINIMAL is
    // invalid on 3.8 Flash; LOW/MEDIUM/HIGH are the only accepted values.
    // Quick hunts run MEDIUM (LOW misses too much); deep hunts run HIGH.
    cfg.thinkingConfig = { thinkingLevel: opts.thinking === "high" ? "HIGH" : opts.thinking === "low" ? "LOW" : "MEDIUM" };
  } else {
    cfg.temperature = 0.2;
    if (opts.thinking === "high") cfg.thinkingConfig = { thinkingBudget: 8192 };
  }
  return cfg;
}

/** Extract Google's human-readable error message from an error body, trimmed. */
function googleErrorSnippet(body: string): string {
  try {
    const msg = (JSON.parse(body) as { error?: { message?: string } })?.error?.message;
    if (typeof msg === "string" && msg.length > 0) return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
  } catch {
    /* not JSON */
  }
  return "";
}

/**
 * Pre-flight probe: can this key actually call this model? A tiny
 * generateContent with the same request shape as a real scan call answers
 * definitively — Google's model list includes deprecated models that new
 * keys cannot call.
 */
export async function probeModel(key: string, model: string): Promise<{ ok: boolean; error?: string }> {
  let res: Response;
  try {
    res = await fetch(`${API}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Reply with exactly: ok" }] }],
        generationConfig: buildGenerationConfig(model, null, { maxOutputTokens: 64 }),
      }),
    });
  } catch {
    return { ok: false, error: "Could not reach the Gemini API from this machine." };
  }
  if (res.ok) return { ok: true };
  const bodyText = await res.text().catch(() => "");
  const detail = googleErrorSnippet(bodyText);
  if (res.status === 404) {
    return {
      ok: false,
      error: `Model ${model} isn't callable by this key (Google closed the 2.5 models to keys created after Sep 2026).`,
    };
  }
  if (res.status === 401) return { ok: false, error: "Gemini rejected the API key. Reconnect it in setup." };
  if (res.status === 403) {
    return { ok: false, error: `This key isn't allowed to call ${model}${detail ? `: ${detail}` : ""}` };
  }
  if (res.status === 429) {
    if (/limit:\s*0\b/.test(bodyText)) return { ok: false, error: `Model ${model} has no quota on this key's tier.` };
    return { ok: false, error: `Gemini rate limit hit during pre-flight — wait a moment and retry.${detail ? ` (${detail})` : ""}` };
  }
  return { ok: false, error: `Gemini API returned ${res.status}${detail ? `: ${detail}` : ""}` };
}

/* ── scan calls ──────────────────────────────────────────────────────────── */

export interface RawFinding {
  file: string;
  line_start: number | null;
  line_end: number | null;
  severity: string;
  category: string;
  title: string;
  explanation: string;
  suggested_fix: string | null;
  confidence: number | null;
}

const SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
const CATEGORIES = new Set(["security", "bug", "logic", "quality"]);

/** Parse + sanitize the model's JSON output into clean findings. Pure & testable. */
export function parseFindings(text: string): RawFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // fallback: extract the outermost JSON array (model wrapped it in prose/markdown)
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const out: RawFinding[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    if (typeof f.file !== "string" || typeof f.title !== "string" || typeof f.explanation !== "string") continue;

    const severity = SEVERITIES.has(f.severity as string) ? (f.severity as string) : "medium";
    const category = CATEGORIES.has(f.category as string) ? (f.category as string) : "bug";
    const confidence = typeof f.confidence === "number" ? f.confidence : null;
    if (confidence !== null && confidence < 0.4) continue;

    out.push({
      file: f.file,
      line_start: Number.isInteger(f.line_start) ? (f.line_start as number) : null,
      line_end: Number.isInteger(f.line_end) ? (f.line_end as number) : null,
      severity,
      category,
      title: f.title.slice(0, 200),
      explanation: f.explanation,
      suggested_fix: typeof f.suggested_fix === "string" ? f.suggested_fix : null,
      confidence,
    });
    if (out.length >= 25) break;
  }
  return out;
}

export type ScanCallResult =
  | { ok: true; findings: RawFinding[] }
  | { ok: false; error: string; quotaExhausted: boolean };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryDelay(body: string): number {
  try {
    const data = JSON.parse(body);
    const details = data?.error?.details as Array<{ retryDelay?: string }> | undefined;
    const d = details?.find((x) => x.retryDelay)?.retryDelay;
    if (d) {
      const secs = parseFloat(d.replace("s", ""));
      if (!Number.isNaN(secs)) return Math.min(secs * 1000, 120_000);
    }
  } catch {
    /* ignore */
  }
  return 0;
}

/**
 * One structured-output scan call with retry/backoff tuned for the free tier.
 * Errors include Google's actual message so the UI can show the real cause.
 */
export async function callGeminiForFindings(
  key: string,
  model: string,
  prompt: string,
  schema: unknown,
  opts: { thinking?: "high" | "low" } = {},
): Promise<ScanCallResult> {
  const backoffs = [0, 8_000, 20_000, 45_000, 90_000];

  for (let attempt = 0; attempt < backoffs.length; attempt++) {
    if (backoffs[attempt] > 0) await sleep(backoffs[attempt]);

    let res: Response;
    try {
      res = await fetch(`${API}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: buildGenerationConfig(model, schema, { thinking: opts.thinking }),
        }),
      });
    } catch {
      return { ok: false, error: "Could not reach the Gemini API from this machine.", quotaExhausted: false };
    }

    if (res.ok) {
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text) return { ok: false, error: "Gemini returned an empty response.", quotaExhausted: false };
      return { ok: true, findings: parseFindings(text) };
    }

    const body = await res.text().catch(() => "");
    const detail = googleErrorSnippet(body);

    if (res.status === 429) {
      // Discriminate by the quotaId Google reports — the body ALWAYS says
      // "Quota exceeded", so matching that text misclassifies per-minute
      // rate limits as daily exhaustion.
      //   ...PerDay...  → daily quota for THIS MODEL (resets midnight PT)
      //   limit: 0      → this model has no quota on this tier at all
      //   otherwise     → per-minute RPM/TPM — honor RetryInfo and retry
      if (/limit:\s*0\b/.test(body)) {
        return {
          ok: false,
          error: `Model ${model} has no quota on this key's tier (limit: 0).`,
          quotaExhausted: true,
        };
      }
      if (/PerDay|per_day/i.test(body)) {
        return {
          ok: false,
          error: `Daily free-tier quota for ${model} is exhausted.`,
          quotaExhausted: true,
        };
      }
      const hinted = parseRetryDelay(body);
      if (hinted > 0) await sleep(hinted);
      continue; // per-minute limit — back off and retry
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Gemini rejected the API key${detail ? `: ${detail}` : ""}. Reconnect it in setup.`, quotaExhausted: false };
    }
    if (res.status === 404) {
      return {
        ok: false,
        error: `Model ${model} isn't callable by this key (Google closed the 2.5 models to newer keys). Reconnect your Gemini key in setup to refresh the model list.`,
        quotaExhausted: false,
      };
    }
    if (res.status >= 500) continue; // transient server error — retry

    return { ok: false, error: `Gemini API returned ${res.status}${detail ? `: ${detail}` : ""}`, quotaExhausted: false };
  }

  return { ok: false, error: "Gemini rate limit persisted after several retries. Re-run the scan shortly.", quotaExhausted: false };
}
