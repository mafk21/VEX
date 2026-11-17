/**
 * Gemini API client. Calls are made directly from the user's machine with
 * their own API key (BYOK) — nothing transits any VEX server.
 */

const API = "https://generativelanguage.googleapis.com/v1beta";

export const DEFAULT_MODEL = "gemini-2.5-flash";

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

/** Pick the best scan model available to this key. */
export function pickModel(models: string[]): string {
  if (models.length === 0) return DEFAULT_MODEL;
  if (models.includes(DEFAULT_MODEL)) return DEFAULT_MODEL;
  const flash = models.find((m) => m.includes("flash") && !m.includes("lite") && !m.includes("image") && !m.includes("tts"));
  return flash ?? models[0];
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
 * One structured-output scan call with retry/backoff tuned for the free tier
 * (~15 RPM). Gives up with a clear error when the daily quota is exhausted.
 */
export async function callGeminiForFindings(
  key: string,
  model: string,
  prompt: string,
  schema: unknown,
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
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 16384,
            responseMimeType: "application/json",
            responseSchema: schema,
          },
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

    if (res.status === 429) {
      const daily = /daily|per.day|quota.*exceed|GenerateRequestsPerDay/i.test(body);
      if (daily) {
        return {
          ok: false,
          error: "Gemini free-tier daily quota is exhausted — it resets at midnight Pacific Time. Try again tomorrow or use a paid key.",
          quotaExhausted: true,
        };
      }
      const hinted = parseRetryDelay(body);
      if (hinted > 0) await sleep(hinted);
      continue; // per-minute limit — back off and retry
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Gemini rejected the API key. Reconnect it in setup.", quotaExhausted: false };
    }
    if (res.status >= 500) continue; // transient server error — retry

    return { ok: false, error: `Gemini API returned ${res.status}.`, quotaExhausted: false };
  }

  return { ok: false, error: "Gemini rate limit persisted after several retries. Re-run the scan shortly.", quotaExhausted: false };
}
