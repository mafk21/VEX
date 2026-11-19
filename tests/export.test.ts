import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarkdownReport } from "../src/lib/export.ts";
import type { ScanRecord, Finding } from "../src/lib/db.ts";

const scan: ScanRecord = {
  id: "test-scan",
  repoFullName: "o/r",
  mode: "quick",
  status: "complete",
  model: "gemini-3.5-flash-lite",
  totalChunks: 1,
  doneChunks: 1,
  coverage: null,
  error: null,
  createdAt: "2026-11-18T10:00:00.000Z",
  finishedAt: "2026-11-18T10:01:00.000Z",
};

function finding(over: Partial<Finding>): Finding {
  return {
    id: 1,
    scanId: "test-scan",
    filePath: "src/a.ts",
    lineStart: 10,
    lineEnd: 12,
    severity: "high",
    category: "security",
    title: "Test finding",
    explanation: "Details.",
    suggestedFix: "Fix it.",
    confidence: 0.9,
    status: "open",
    createdAt: "2026-11-18T10:00:30.000Z",
    ...over,
  };
}

test("markdown report includes triage summary when findings are triaged", () => {
  const md = buildMarkdownReport(scan, [
    finding({ id: 1, status: "confirmed" }),
    finding({ id: 2, status: "false_positive", severity: "medium" }),
    finding({ id: 3, status: "open", severity: "low" }),
  ]);
  assert.match(md, /\*\*Triage:\*\* 1 confirmed · 1 false positive · 0 ignored · 1 still open/);
  assert.match(md, /_confirmed_/); // status marker on the finding line
  assert.match(md, /_false positive_/);
});

test("markdown report omits triage summary when nothing is triaged", () => {
  const md = buildMarkdownReport(scan, [finding({ id: 1 })]);
  assert.doesNotMatch(md, /\*\*Triage:\*\*/);
  assert.match(md, /## High \(1\)/);
});
