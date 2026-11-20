import { test } from "node:test";
import assert from "node:assert/strict";
import { scanFileForPatterns } from "../src/lib/patterns.ts";

test("detects hardcoded credentials with correct line numbers", () => {
  const code = [
    "// config",
    'const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";',
    'const db = "safe";',
    "-----BEGIN RSA PRIVATE KEY-----",
  ].join("\n");
  const out = scanFileForPatterns("src/config.ts", code);
  const aws = out.find((f) => f.title.includes("AWS"));
  const pk = out.find((f) => f.title.includes("Private key"));
  assert.ok(aws && aws.line_start === 2 && aws.severity === "critical");
  assert.ok(pk && pk.line_start === 4);
});

test("suppresses placeholders and env references", () => {
  const code = [
    'const key = "your-api-key-here";',
    'const SECRET = process.env.APP_SECRET ?? "fallback";',
    'password = "examplepassword123"',
  ].join("\n");
  const out = scanFileForPatterns("src/app.py", code);
  assert.equal(out.filter((f) => f.title === "Hardcoded secret in assignment").length, 0);
});

test("catches SQL string interpolation and unsafe pickle", () => {
  const js = 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);';
  const py = "data = pickle.loads(request.body)";
  const jsOut = scanFileForPatterns("src/db.ts", js);
  const pyOut = scanFileForPatterns("src/handler.py", py);
  assert.equal(jsOut[0]?.title, "SQL query built with string interpolation");
  assert.equal(jsOut[0]?.severity, "high");
  assert.equal(pyOut[0]?.title, "Unsafe deserialization (pickle.loads)");
});

test("respects file-type scoping and skips minified lines", () => {
  const evalInMd = 'eval("x")'; // not a script file
  assert.equal(scanFileForPatterns("README.md", evalInMd).length, 0);
  const minified = `const k="${"A".repeat(700)}"; eval(x);`;
  assert.equal(scanFileForPatterns("src/bundle.js", minified).length, 0);
});
