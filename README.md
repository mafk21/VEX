<div align="center">

<img src="assets/logo.png" alt="VEX logo" width="600" />

# VEX

**The AI code hunter that lives on your machine.**

[![License: Source-Available (Personal Use)](https://img.shields.io/badge/license-source--available-red)](./LICENSE)
[![Node ≥ 22.5](https://img.shields.io/badge/node-%E2%89%A5%2022.5-339933)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![Local-first](https://img.shields.io/badge/local--first-no%20telemetry-2ee6a8)](#why-local-first)
[![CI](https://github.com/mafk21/VEX/actions/workflows/ci.yml/badge.svg)](https://github.com/mafk21/VEX/actions/workflows/ci.yml)

</div>

Connect your GitHub account, bring your own Gemini API key, pick a repo — and VEX
hunts the code for **bugs, vulnerabilities, logic-flow breaks, and quality
issues**, then shows you exactly where each problem lives and how to fix it.

- 🔍 **Whole-repo hunts** — smart file selection + token-budgeted chunking, grounded with real line numbers
- ⚡ **Two modes** — quick hunts on a free Gemini key, or deep reasoning on paid tier
- 📊 **A real report UI** — severity dashboard, filters, syntax-highlighted code context, GitHub deep-links
- ✅ **A triage workflow** — mark findings confirmed / false positive / ignored, track progress, export carries your verdicts
- 🔐 **Local-first** — no accounts, no telemetry, keys encrypted at rest, one-click data wipe
- ⏸️ **Resumable** — close the app mid-hunt, it picks up where it left off
- 📤 **Export** — Markdown & JSON reports, straight from the scan page

## What a hunt looks like

Every finding comes with evidence — file, lines, confidence, and a concrete fix:

> ### 1. Unsanitized user input reaches SQL query
>
> `src/api/users.ts:44–49` · **security** · 92% confidence
>
> `getUser()` interpolates the `id` route parameter directly into the SQL string.
> An attacker can pass `' OR '1'='1` to dump the users table. The same pattern
> appears in `deleteUser()` on line 71.
>
> **Suggested fix**
>
> ```
> const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
> return stmt.get(id);
> ```

Export any hunt as a shareable Markdown report (`↓ md`) or as JSON (`↓ json`).

## Quick start

Requires **Node.js ≥ 22.5** (VEX uses the built-in SQLite module).
Copy-paste, line by line:

```bash
git clone https://github.com/mafk21/VEX.git
cd VEX
npm install
npm start
```

Then open **http://localhost:3000**. First run builds the app (~1 minute);
after that it starts instantly.

<details>
<summary>🧪 No Gemini key yet? Run the demo instead</summary>

```bash
# macOS / Linux
VEX_MOCK_GEMINI=1 npm start

# Windows PowerShell
$env:VEX_MOCK_GEMINI="1"; npm start
```

Demo mode runs the entire pipeline — repo fetch, filtering, chunking, report —
with clearly-labeled sample findings. No API key or quota needed.

</details>

## Setup (one time, ~2 minutes)

**1 · GitHub token** — [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
→ **Generate new token** (fine-grained) → Repository access: *All repositories*
(or pick some) → Permissions → **Contents: Read-only** → Generate.
That's the only permission VEX needs. (A classic PAT with the `repo` scope also works.)

**2 · Gemini API key** — [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
→ **Create API key**. The free tier works (~500 requests/day on Flash-Lite; a hunt
uses roughly one request per ~120K tokens of code).

> VEX discovers the models your key can actually call at the start of every hunt
> and probes them before scanning — Google's model lineup changes fast, and VEX
> adapts automatically instead of going stale.

**3 · Hunt** — pick a repo on the dashboard → **⌖ hunt**. Watch live progress,
then browse the report.

## Scan modes

| Mode | Model | Best for |
|---|---|---|
| **⌖ hunt** (quick) | Gemini Flash-Lite (free tier: ~500 req/day) | Everyday scans; works on free keys |
| **deep** | Strongest available model (e.g. Gemini 3.8 Flash) + high reasoning | Thorough audits; best on a paid-tier key (free tier is ~20 req/day here) |

## How it works

```
repo ──▶ GitHub tree ──▶ filter (skip junk, prioritize security-sensitive paths)
                         ──▶ pack into ~120K-token chunks, line-numbered
                         ──▶ Gemini (structured JSON findings) ──▶ SQLite ──▶ report UI
```

- The scan worker runs in the background, throttled to stay inside free-tier
  rate limits, with backoff on 429s.
- Hunts are **cancellable** and **resumable** — interrupted hunts continue on
  next start.
- Files are cached locally, so re-hunting a repo is fast.

## Why local-first?

Your code and keys are the most sensitive things you own. So VEX has **no server
side at all**:

```
┌─────────────────────────── YOUR MACHINE ───────────────────────────┐
│  Browser (127.0.0.1 UI)                                            │
│     │                                                              │
│     ▼                                                              │
│  Local Next.js server                                              │
│     ├── ~/.vex/config.json   keys, AES-256-GCM encrypted, mode 600 │
│     ├── .vex/vex.db (SQLite) scans, findings, source cache         │
│     └── scan worker (background queue, ~12 Gemini calls/min)       │
│           │                              │                         │
└───────────┼──────────────────────────────┼─────────────────────────┘
            ▼                              ▼
      api.github.com              generativelanguage.googleapis.com
      (your PAT, read-only)       (your own key, your quota)
```

- **No accounts, no telemetry, no cloud database.** Uninstall = delete the folder.
- Keys are encrypted at rest with a machine-derived key and never leave your device.
- The only outbound traffic is direct from your machine to GitHub and Google.
- ⚠️ **Free-tier Gemini keys** may allow Google to use prompts (your code) for
  training — the app asks you to acknowledge this at setup. Paid-tier keys are
  not used for training. Use a paid key for sensitive private repos.

## Reports & data

- **Export** any scan as Markdown or JSON from the scan page (`↓ md` / `↓ json`).
- **History** lives at `/scans`; the dashboard shows each repo's last hunt.
- **Privacy controls** live at `/settings`: disconnect keys, or wipe *everything*
  (keys + full scan history) with one click.

## Dev notes

```bash
npm test                        # unit tests (node:test, type-stripped TS)
npm run dev                     # development mode (hot reload)
VEX_MOCK_GEMINI=1 npm run dev   # demo the full pipeline without a Gemini key
PORT=8080 npm start             # custom port
```

On **Windows PowerShell**, set env vars like this instead:

```powershell
$env:VEX_MOCK_GEMINI="1"; npm run dev
$env:PORT="8080"; npm start
```

Data directory: `~/.vex` by default; override with `VEX_DATA_DIR=/path/to/dir`.

## Roadmap

VEX **v1.0** is feature-complete: engine, report UI, deep scan, export, privacy
controls, tests, CI. On the horizon: `npx vex` one-shot runs, diff-based re-hunts
(only what changed), and a Tauri desktop wrapper. See [PLAN.md](./PLAN.md).

## Community

- [Contributing guide](./CONTRIBUTING.md) — setup, tests, PR process
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security policy](./SECURITY.md) — how to report a vulnerability privately
- [Changelog](./CHANGELOG.md)

## License

VEX is source-available under the **VEX Personal-Use License** — see
[LICENSE](./LICENSE). In short: run and modify it freely on your own devices for
personal use; no redistribution and no commercial use. Scan only code you own or
are authorized to analyze.
