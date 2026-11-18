# VEX — Build Plan (Local-First)

**Concept:** VEX is an AI code hunter that runs **entirely on the user's own device**.
They connect their GitHub account and Gemini API key, pick one of their repos, and VEX
scans the code for bugs, vulnerabilities, logic-flow breaks, and code-quality issues —
then presents a structured, actionable report.

**Privacy promise:** API keys, tokens, repo code, and scan results live only on the
user's machine. The only outbound traffic is direct user→GitHub and user→Gemini API
calls. No VEX server ever sees anything. No account, no telemetry, no cloud database.

## Architecture

```
┌─────────────────────────── USER'S DEVICE ───────────────────────────┐
│  Browser (localhost UI)                                             │
│     │                                                               │
│     ▼                                                               │
│  Local Next.js server (127.0.0.1)                                   │
│     ├── SQLite database  (.vex/vex.db)  → scans, findings, history  │
│     ├── Config store     (.vex/config)  → encrypted keys, mode 0600 │
│     └── Scan worker (in-process background queue)                   │
│           │                              │                          │
└───────────┼──────────────────────────────┼──────────────────────────┘
            ▼                              ▼
      GitHub REST API                Gemini API
   (user's PAT, from their      (user's own key, from their
    machine, read-only)          machine, their quota)
```

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router, TypeScript) | Local full-stack in one process; `npm start` and go |
| Styling | Tailwind CSS | Fast iteration |
| Database | SQLite via `better-sqlite3` | Zero-config, file-based, lives in `.vex/` on disk |
| GitHub data | GitHub REST API (Octokit) + Personal Access Token | No OAuth app/server needed; fine-grained PAT with read-only repo access |
| AI engine | Gemini API (`@google/genai`), Flash default | 1M-token context, structured JSON output, free tier OK |
| Distribution | Git clone / `npm install && npm start` (later: npm package, Tauri desktop app) | Local-first delivery |

## Key Design Decisions

1. **Runs on localhost only.** The server binds to `127.0.0.1`. Nothing is deployed;
   there is no hosted version.
2. **BYOK, stored locally:** the Gemini key and GitHub PAT are stored in
   `.vex/config` with `0600` permissions (optionally encrypted with a machine-derived
   key). They are used only for direct calls from the user's device.
3. **GitHub auth via PAT** (not OAuth): OAuth requires a client secret on a server,
   which contradicts local-first. A fine-grained PAT (read-only `contents` access) is
   the standard for local dev tools. Stretch: GitHub Device Flow.
4. **Flash first, Pro optional:** free-tier keys scan with Gemini Flash (1M context,
   ~1,500 req/day). Paid keys unlock "Deep Scan" (Pro + extended thinking).
5. **In-process scan queue:** because we run locally there are no serverless timeouts —
   a background worker processes chunk jobs sequentially with throttling to respect the
   free tier's ~15 requests/minute. Scans survive UI refresh; resumable after restart.
6. **Line-number grounding:** code is sent to Gemini with line numbers prepended so
   findings reference accurate locations.
7. **Structured output:** Gemini is constrained by a JSON schema so every finding is
   machine-readable (file, lines, severity, category, explanation, suggested fix).
8. **Privacy disclosure:** code is the one thing that leaves the machine (→ Gemini),
   and free-tier Gemini prompts may be used by Google for training — disclosed clearly
   at key-connect time; paid keys are not used for training.

## Data Model (SQLite, `.vex/vex.db`)

- `settings` — encrypted Gemini key, encrypted GitHub PAT, key tier, prefs
- `repos` — cached repo list: github id, full_name, default_branch, language, visibility
- `scans` — repo ref, mode (quick/deep), status (queued → fetching → scanning →
  complete/failed), model, coverage stats, timestamps, error
- `scan_chunks` — scan id, index, file list, est. tokens, status
- `findings` — scan id, file_path, line_start/end, severity
  (critical/high/medium/low/info), category (security/bug/logic/quality), title,
  explanation, suggested_fix, confidence

## Local API Routes

- `POST /api/keys/gemini` / `POST /api/keys/github` — validate (live test call) + store locally
- `GET /api/status` — which connections are configured (never returns key material)
- `GET /api/repos` — list repos from GitHub (refresh local cache)
- `POST /api/scans` — create scan for a repo (builds chunk plan)
- `GET /api/scans/:id` — status, progress
- `GET /api/scans/:id/findings` — full findings list
- `POST /api/scans/:id/cancel` — stop a running scan
- `DELETE /api/data` — wipe all local data (keys, history) — privacy control

## Gemini Finding Schema (structured output)

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "file": { "type": "string" },
      "line_start": { "type": "integer" },
      "line_end": { "type": "integer" },
      "severity": { "enum": ["critical", "high", "medium", "low", "info"] },
      "category": { "enum": ["security", "bug", "logic", "quality"] },
      "title": { "type": "string" },
      "explanation": { "type": "string" },
      "suggested_fix": { "type": "string" },
      "confidence": { "type": "number" }
    },
    "required": ["file", "line_start", "severity", "category", "title", "explanation"]
  }
}
```

---

## Sprint 1 — Local Foundation & Connections (25%)

**Goal:** `npm start` → browser opens on localhost → user connects GitHub PAT + Gemini
key → sees their repos.

- [ ] Scaffold Next.js + TypeScript + Tailwind (local-first; bind 127.0.0.1)
- [ ] SQLite layer (`better-sqlite3`), schema for all tables, `.vex/` data dir
- [ ] Local config store with `0600` perms for keys (+ machine-key encryption)
- [ ] Onboarding flow: paste GitHub PAT (validate via `/user`, check scopes) →
      paste Gemini key (validate via test call) → privacy disclosure (code → Gemini;
      free-tier training notice)
- [ ] Landing page + dashboard shell (dark, developer-tool aesthetic)
- [ ] Repo list page: fetch from GitHub API, name/language/visibility/updated
- [ ] Connection status indicators; disconnect = local key deletion

**Done when:** a fresh clone runs locally end-to-end: connect both keys, browse repos.

## Sprint 2 — Scan Engine (50%) ✅

**Goal:** end-to-end local pipeline from "pick a repo" to findings rows in SQLite.

- [x] Repo file-tree fetch via GitHub API (git trees endpoint, BFS fallback for truncated trees)
- [x] File filtering & prioritization: skip binaries, lockfiles, `node_modules`,
      generated/minified code, assets; rank by language and path importance
- [x] Token-budget packer: group files into chunks ≤ budget, line-number the content
- [x] Scan prompt: security/bug/logic/quality hunting instructions + schema
- [x] Gemini service: Flash call with structured output, retry/backoff on 429
- [x] In-process background worker: sequential chunk queue, ~12 RPM throttle,
      resumable after app restart, cancellable
- [x] Findings writer: dedupe, persist to SQLite
- [x] Scan status machine + error capture (quota exceeded, GitHub errors, huge repos)
- [x] Minimal live scan-status page (progress, cancel, raw findings) + hunt button on repo cards
- [x] `VEX_MOCK_GEMINI=1` mock mode for offline dev/demo

**Done when:** scanning a real repo produces structured findings in the local DB,
resilient to rate limits, with live progress readable from the scan record.

## Sprint 3 — Report UI (75%) ✅

**Goal:** the full findings experience — the product's payoff screen.

- [x] Live scan progress page (chunks done/total, current files, elapsed + ETA, cancel)
- [x] Findings dashboard: severity summary cards (click to filter), category tabs, sort
- [x] Finding card/detail: title, severity badge, file + line range, explanation,
      suggested fix block, GitHub deep-link to the exact lines
- [x] Code viewer with syntax highlighting (highlight.js, multiline-aware),
      auto-scrolled to flagged lines, served from the local source cache
- [x] Scan history page + per-repo last-scan badges on the dashboard
- [x] Empty states, loading skeletons, quota-exceeded / partial-failure messaging

**Done when:** run a scan → browse a clean, useful report with code context and fixes.

## Sprint 4 — Polish, Deep Scan & Ship (100%) ✅

- [x] Deep Scan mode: Pro model + 8K thinking budget + smaller (60K-token) chunks;
      pre-flight probe fails fast with a clear message on free-tier keys
- [x] Rate-limit UX: live ETA, throttle notice, daily-quota error messaging
      ("resets midnight PT")
- [x] Local export: report → Markdown/JSON download (`/api/scans/:id/export`)
- [x] Privacy controls: /settings page — disconnect keys, one-click full data wipe
      (`DELETE /api/data`)
- [x] Hardening: error boundary + 404 pages, graceful SIGINT/SIGTERM shutdown,
      port override via `PORT`
- [x] Unit tests: 15 tests (filter, packer, findings parser) via `node --test`
- [x] README: privacy architecture, setup walkthroughs, scan modes, dev notes
- [x] Test matrix: small repo, large repo (442 files / 9 chunks), private repo,
      deep-scan rejection on flash-only key, export, wipe, offline-cache fallback
- [ ] Stretch: npm global package (`npx vex`), Tauri desktop wrapper — future

**Done when:** any developer can clone, run, and hunt bugs in their repo in <5 minutes,
with their data never leaving their machine.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Free-tier 15 RPM bursts → 429s | Sequential chunk queue with throttle + exponential backoff |
| Repo bigger than 1M tokens | Prioritized file selection + multi-chunk passes; report coverage honestly |
| LLM line-number drift | Pre-number lines; validate ranges before rendering |
| Users unfamiliar with PATs | In-app walkthrough with screenshots; validate scopes on save |
| Keys on disk in plaintext risk | `0600` perms + machine-derived encryption; documented |
| Free-tier Gemini trains on code | Prominent disclosure; recommend paid key for sensitive code |
| Long scans blocking the server | Background worker process, non-blocking UI, resumable |
