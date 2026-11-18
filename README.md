# VEX

**VEX is a local-first AI code hunter.** Connect your GitHub account and your own
Gemini API key, pick a repo, and VEX hunts the code for bugs, vulnerabilities,
logic-flow breaks, and quality issues — then shows you exactly where and how to fix them.

Everything runs on **your machine**: keys are encrypted in a local config file
(`0600`), findings live in a local SQLite database, and the only outbound traffic is
direct from your device to GitHub and to Google's Gemini API. No accounts, no cloud
database, no telemetry.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000  (dev)
# or
npm run build && npm start   # production, binds to 127.0.0.1 only
```

Then open the app and connect:

1. **GitHub token** — [github.com/settings/tokens](https://github.com/settings/tokens?type=beta)
   → fine-grained token with **Contents: Read-only** (classic PAT with `repo` scope also works).
2. **Gemini API key** — [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
   The free tier works; note that Google may use free-tier prompts for training
   (you'll be asked to acknowledge this in the app).

Data lives in `~/.vex/` by default (override with `VEX_DATA_DIR`).

> **Dev/demo without a Gemini key:** run with `VEX_MOCK_GEMINI=1` to exercise the full
> scan pipeline with canned findings (clearly labeled `[MOCK]` in the report).

## Status

- [x] **Sprint 1** — local foundation, GitHub + Gemini connections, repo browser
- [x] **Sprint 2** — scan engine (chunked Gemini analysis pipeline)
- [x] **Sprint 3** — findings report UI (severity dashboard, code viewer, history)
- [ ] **Sprint 4** — deep scan, export, hardening

See [PLAN.md](./PLAN.md) for the full build plan.
