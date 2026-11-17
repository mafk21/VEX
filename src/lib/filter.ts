/**
 * File filtering & prioritization: decide which files in a repo tree are
 * worth spending tokens on, and in what order they should be scanned.
 */

export interface TreeEntry {
  path: string;
  size: number;
}

export interface SelectedFile extends TreeEntry {
  priority: number; // lower = scanned earlier
}

// Directories that never contain audit-worthy first-party code
const SKIP_DIRS =
  /(^|\/)(node_modules|\.git|\.?_next|\.nuxt|\.svelte-kit|dist|build|out|coverage|\.cache|\.venv|venv|__pycache__|target|vendor|\.idea|\.vscode|\.turbo|\.parcel-cache|\.pytest_cache|\.mypy_cache|\.tox|\.nox|public\/vendor)\//;

// Dependency manifests / lockfiles / noise
const SKIP_FILES =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|gemfile\.lock|poetry\.lock|cargo\.lock|go\.sum|\.ds_store|thumbs\.db)$/i;

// Binaries, media, styles, docs, data — no audit value for this tool
const SKIP_EXT =
  /\.(png|jpe?g|gif|webp|avif|ico|svg|pdf|zip|tar|gz|tgz|bz2|xz|7z|rar|woff2?|ttf|otf|eot|mp[34]|mov|avi|mkv|wav|flac|ogg|exe|dll|so|dylib|bin|dat|class|jar|war|pyc|pyo|db|sqlite3?|wasm|map|css|s[ac]ss|less|mdx?|markdown|rst|txt|csv|tsv|parquet|ipynb|snap)$/i;

// Generated / type-only code
const SKIP_GENERATED = /(\.generated\.|\.gen\.|\.pb\.|\.g\.|\.d\.ts$|_pb2?\.py$|\.designer\.(cs|vb)$)/i;

// Tier 0 — real source code
const CODE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|py|go|rs|rb|java|kt|kts|swift|php|c|cc|cpp|cxx|h|hpp|cs|dart|scala|lua|r|sql|sh|bash|zsh|ps1|vue|svelte|ex|exs|erl|hrl|clj|cljs|groovy|pl|pm|zig|nim|cr)$/i;

// Tier 1 — config & infrastructure (secrets, misconfigurations live here)
const CONFIG_EXT = /\.(json|ya?ml|toml|ini|cfg|conf|tf|hcl|prisma|graphql|gql|proto|xml|env)$/i;
const CONFIG_NAMES = /(^|\/)(dockerfile|docker-compose[^/]*|makefile|\.env[^/]*|\.npmrc|\.htaccess|web\.config)$/i;

// Tier 2 — templates (can carry XSS / injection)
const TEMPLATE_EXT = /\.(html?|ejs|hbs|mustache|twig|liquid|erb|jinja2?|njk)$/i;

// Paths where vulnerabilities hurt most — scan these first
const HIGH_VALUE_PATH =
  /auth|login|signin|signup|register|password|passwd|secret|token|apikey|api[_-]?key|crypto|encrypt|payment|billing|checkout|stripe|jwt|session|cookie|middleware|guard|permission|acl|admin|upload|download|file|exec|eval|query|sql|db|database|api|server|route|controller|handler|webhook|callback|oauth|saml|csrf|cors|redirect|proxy|deserialize|sanitiz/i;

export const MAX_FILE_BYTES = 150_000; // ~37K tokens — bigger files are usually generated
export const MAX_FILES_PER_SCAN = 600;

export interface FilterResult {
  selected: SelectedFile[];
  skipped: number; // excluded by rules
  oversized: number; // excluded by size cap
  totalBlobs: number;
}

export function filterTree(entries: TreeEntry[]): FilterResult {
  const selected: SelectedFile[] = [];
  let skipped = 0;
  let oversized = 0;

  for (const e of entries) {
    const p = e.path;
    if (SKIP_DIRS.test(p) || SKIP_FILES.test(p) || SKIP_EXT.test(p) || SKIP_GENERATED.test(p)) {
      skipped++;
      continue;
    }

    let tier: number;
    if (CODE_EXT.test(p)) tier = 0;
    else if (CONFIG_EXT.test(p) || CONFIG_NAMES.test(p)) tier = 1;
    else if (TEMPLATE_EXT.test(p)) tier = 2;
    else {
      skipped++;
      continue;
    }

    if (e.size > MAX_FILE_BYTES) {
      oversized++;
      continue;
    }

    const highValue = HIGH_VALUE_PATH.test(p) ? 0 : 1;
    // priority: security-sensitive paths → code before config → smaller files first
    const priority = highValue * 1_000_000_000 + tier * 100_000_000 + Math.min(e.size, 99_999_999);
    selected.push({ ...e, priority });
  }

  selected.sort((a, b) => a.priority - b.priority);
  const capped = selected.slice(0, MAX_FILES_PER_SCAN);

  return {
    selected: capped,
    skipped: skipped + (selected.length - capped.length),
    oversized,
    totalBlobs: entries.length,
  };
}
