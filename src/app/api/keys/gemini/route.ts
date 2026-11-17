import { NextRequest, NextResponse } from "next/server";
import { validateGeminiKey, summarizeModels } from "@/lib/gemini";
import { saveGemini, clearKey } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Validate a Gemini API key (live call from this machine) and store it encrypted locally. */
export async function POST(req: NextRequest) {
  let body: { key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) {
    return NextResponse.json({ ok: false, error: "Paste your API key first." }, { status: 400 });
  }

  const result = await validateGeminiKey(key);
  if (!result.ok) {
    const msg =
      result.error === "invalid"
        ? "Google rejected this API key. Create or copy one at aistudio.google.com/apikey."
        : result.error === "unreachable"
          ? "Could not reach the Gemini API from this machine. Check your internet connection."
          : result.error;
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  saveGemini(key, result.models);
  return NextResponse.json({ ok: true, models: summarizeModels(result.models) });
}

/** Disconnect = delete the key from local storage. */
export function DELETE() {
  clearKey("gemini");
  return NextResponse.json({ ok: true });
}
