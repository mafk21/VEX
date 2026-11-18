# Changelog

All notable changes to VEX are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] — 2026-11-18

First public release.

### Added
- **Local-first scan engine** — GitHub tree fetch, smart file filtering,
  token-budgeted chunking, Gemini structured-output analysis, throttled and
  resumable background worker
- **Two scan modes** — ⌖ hunt (Flash, free-tier friendly) and deep (Pro +
  extended reasoning, paid tier)
- **Report UI** — severity dashboard, category filters, syntax-highlighted
  code viewer with flagged lines, GitHub deep-links, scan history
- **BYOK onboarding** — GitHub PAT + Gemini key, AES-256-GCM encrypted at rest
- **Privacy controls** — settings page, key disconnect, one-click full data wipe
- **Export** — Markdown and JSON reports
- **Demo mode** — `VEX_MOCK_GEMINI=1` runs the whole pipeline without a key
- 15 unit tests, CI, error pages, graceful shutdown
- Docs: README, PLAN, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, custom
  Personal-Use License
