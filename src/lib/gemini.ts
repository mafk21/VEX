/**
 * Gemini API client. Calls are made directly from the user's machine with
 * their own API key (BYOK) — nothing transits any VEX server.
 */

const API = "https://generativelanguage.googleapis.com/v1beta";

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

/** Split a model list into scan-relevant families for display / future mode selection. */
export function summarizeModels(models: string[]): { flash: string[]; pro: string[] } {
  return {
    flash: models.filter((m) => m.includes("flash")),
    pro: models.filter((m) => m.includes("pro")),
  };
}
