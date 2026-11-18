import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFindings, pickModel, pickProModel } from "../src/lib/gemini.ts";

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

test("pickModel prefers stable flash; pickProModel prefers pro", () => {
  const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"];
  assert.equal(pickModel(models), "gemini-2.5-flash");
  assert.equal(pickProModel(models), "gemini-2.5-pro");
  assert.equal(pickProModel(["gemini-2.5-flash"]), null);
  assert.equal(pickModel([]), "gemini-2.5-flash"); // default fallback
});
