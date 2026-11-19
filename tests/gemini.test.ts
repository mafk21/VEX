import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFindings,
  pickModel,
  pickDeepModel,
  quickCandidates,
  buildGenerationConfig,
  isGemini3Plus,
} from "../src/lib/gemini.ts";

test("parseFindings parses clean JSON", () => {
  const input = JSON.stringify([
    {
      file: "src/auth.ts",
      line_start: 42,
      line_end: 48,
      severity: "critical",
      category: "security",
      title: "SQL injection",
      explanation: "String concat into query",
      suggested_fix: "Use parameterized queries",
      confidence: 0.95,
    },
  ]);
  const out = parseFindings(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].file, "src/auth.ts");
  assert.equal(out[0].severity, "critical");
});

test("parseFindings extracts JSON from markdown-wrapped output", () => {
  const input = "Here are the findings:\n```json\n[{\"file\":\"a.py\",\"line_start\":1,\"severity\":\"high\",\"category\":\"bug\",\"title\":\"t\",\"explanation\":\"e\"}]\n```";
  const out = parseFindings(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].file, "a.py");
});

test("parseFindings drops low-confidence and invalid entries", () => {
  const input = JSON.stringify([
    { file: "a.ts", line_start: 1, severity: "high", category: "bug", title: "ok", explanation: "e", confidence: 0.9 },
    { file: "b.ts", line_start: 1, severity: "high", category: "bug", title: "shaky", explanation: "e", confidence: 0.2 },
    { file: "c.ts" }, // missing required fields
  ]);
  const out = parseFindings(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "ok");
});

test("parseFindings defaults unknown severity/category and clamps at 25", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    file: `f${i}.ts`, line_start: 1, severity: "catastrophic", category: "weird", title: `t${i}`, explanation: "e",
  }));
  const out = parseFindings(JSON.stringify(many));
  assert.equal(out.length, 25);
  assert.equal(out[0].severity, "medium"); // unknown → medium
  assert.equal(out[0].category, "bug"); // unknown → bug
});

test("parseFindings returns [] on garbage", () => {
  assert.deepEqual(parseFindings("not json at all"), []);
  assert.deepEqual(parseFindings("{}"), []);
});

test("pickModel prefers free-tier 3.x flash-lite over deprecated 2.5 models", () => {
  // Google's list endpoint still returns 2.5 models to keys that cannot call them
  const models = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.8-flash", "gemini-3.5-flash-lite"];
  assert.equal(pickModel(models), "gemini-3.5-flash-lite");
  assert.equal(pickDeepModel(models), "gemini-3.8-flash");
});

test("legacy 2.5-only lists still resolve (keys with grandfathered access)", () => {
  const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"];
  assert.equal(pickModel(models), "gemini-2.5-flash");
  assert.equal(pickDeepModel(models), "gemini-2.5-pro");
});

test("model fallbacks on empty lists use current defaults", () => {
  assert.equal(pickModel([]), "gemini-3.5-flash-lite");
  assert.equal(pickDeepModel([]), "gemini-3.8-flash");
});

test("quickCandidates puts deprecated 2.5 last", () => {
  const c = quickCandidates(["gemini-2.5-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  assert.equal(c[0], "gemini-3.5-flash-lite");
  assert.equal(c[c.length - 1], "gemini-2.5-flash");
});

test("isGemini3Plus detects API generation", () => {
  assert.equal(isGemini3Plus("gemini-3.8-flash"), true);
  assert.equal(isGemini3Plus("gemini-4-hydrogen"), true);
  assert.equal(isGemini3Plus("gemini-2.5-flash"), false);
});

test("buildGenerationConfig uses the Gemini 3 shape for 3.x models", () => {
  const cfg = buildGenerationConfig("gemini-3.8-flash", { type: "ARRAY" }, { thinking: "high" });
  assert.equal("temperature" in cfg, false); // removed in the Gemini 3 API
  assert.equal("top_p" in cfg, false);
  assert.deepEqual(cfg.thinkingConfig, { thinkingLevel: "HIGH" });
  assert.equal(cfg.responseMimeType, "application/json");
  const plain = buildGenerationConfig("gemini-3.5-flash-lite", null);
  assert.deepEqual(plain.thinkingConfig, { thinkingLevel: "MEDIUM" });
  assert.equal("responseMimeType" in plain, false); // probe calls: no schema
});

test("buildGenerationConfig keeps the legacy shape for 2.x models", () => {
  const cfg = buildGenerationConfig("gemini-2.5-flash", { type: "ARRAY" }, { thinking: "high" });
  assert.equal(cfg.temperature, 0.2);
  assert.deepEqual(cfg.thinkingConfig, { thinkingBudget: 8192 });
});
