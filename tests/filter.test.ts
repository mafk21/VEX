import { test } from "node:test";
import assert from "node:assert/strict";
import { filterTree } from "../src/lib/filter.ts";

test("skips junk: node_modules, lockfiles, binaries, styles, docs", () => {
  const { selected, skipped } = filterTree([
    { path: "src/index.ts", size: 1000 },
    { path: "node_modules/react/index.js", size: 5000 },
    { path: "package-lock.json", size: 90000 },
    { path: "logo.png", size: 20000 },
    { path: "styles.css", size: 3000 },
    { path: "README.md", size: 2000 },
    { path: "dist/bundle.js", size: 80000 },
    { path: "src/api.min.js", size: 40000 },
    { path: "types/global.d.ts", size: 500 },
  ]);
  assert.equal(skipped, 8);
  assert.deepEqual(selected.map((f) => f.path), ["src/index.ts"]);
});

test("prioritizes security-sensitive paths first", () => {
  const { selected } = filterTree([
    { path: "src/utils/helpers.ts", size: 100 },
    { path: "src/auth/login.ts", size: 5000 },
    { path: "src/config.yaml", size: 100 },
  ]);
  assert.equal(selected[0].path, "src/auth/login.ts");
  assert.equal(selected[1].path, "src/utils/helpers.ts"); // code before config
  assert.equal(selected[2].path, "src/config.yaml");
});

test("caps oversized files and reports them", () => {
  const { selected, oversized } = filterTree([
    { path: "src/big.ts", size: 500_000 },
    { path: "src/ok.ts", size: 10_000 },
  ]);
  assert.equal(oversized, 1);
  assert.deepEqual(selected.map((f) => f.path), ["src/ok.ts"]);
});

test("config files and templates are included at lower priority", () => {
  const { selected } = filterTree([
    { path: "Dockerfile", size: 800 },
    { path: "views/page.html", size: 1200 },
    { path: "src/app.py", size: 3000 },
  ]);
  assert.equal(selected.length, 3);
  assert.equal(selected[0].path, "src/app.py");
});
