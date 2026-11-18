import { test } from "node:test";
import assert from "node:assert/strict";
import { planChunks, numberLines, estimateTokens } from "../src/lib/packer.ts";

test("numberLines prepends aligned line numbers", () => {
  const { text, lines } = numberLines("a\nb\nc");
  assert.equal(lines, 3);
  assert.equal(text, "1 | a\n2 | b\n3 | c");
});

test("numberLines pads for double-digit files", () => {
  const { text } = numberLines(Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join("\n"));
  assert.ok(text.startsWith(" 1 | line1"));
  assert.ok(text.includes("12 | line12"));
});

test("planChunks respects the token budget", () => {
  const budget = 1000; // tiny budget for the test
  const files = Array.from({ length: 10 }, (_, i) => ({
    path: `f${i}.ts`,
    size: 1000, // ~250 tokens each
    priority: i,
  }));
  const chunks = planChunks(files, budget);
  assert.ok(chunks.length >= 3, "should split into multiple chunks");
  for (const c of chunks) {
    assert.ok(c.estTokens <= budget + 280, `chunk ${c.idx} est ${c.estTokens} within budget+overhead`);
  }
  assert.equal(chunks.flatMap((c) => c.files).length, 10, "no files lost");
});

test("planChunks handles a single oversized-but-allowed file", () => {
  const chunks = planChunks([{ path: "big.ts", size: 100_000, priority: 0 }], 5000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].files.length, 1);
});

test("estimateTokens is ~4 chars/token", () => {
  assert.equal(estimateTokens(400), 100);
});
