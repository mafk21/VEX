# Changelog

All notable changes to VEX are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.1] — 2026-11-18

### Fixed
- **Chunk failures from TPM 429-storms**: the throttle paced requests/minute but
  ignored tokens/minute — two ~120K-token chunks in one minute slammed the free
  tier's 250K TPM limit. The scanner now paces against BOTH windows (rolling
  60s token budget + RPM + minimum interval), and chunks are sized at ~60K
  tokens so three per minute fit with headroom.
- **Misleading "Clean hunt" banner**: a hunt with failed chunks no longer
  declares victory — it shows "⚠ Incomplete hunt" and tells you to treat zero
  findings with suspicion.
- **Honest coverage numbers**: files are only counted as scanned when their
  chunk was actually analyzed (fetching ≠ analyzing).
- Partial-failure messages now include the first real error.

### Changed
- Quick hunts run at thinking level MEDIUM — LOW was fast but missed too much.

## [1.1.0] — 2026-11-18

### Added
- **Triage workflow**: every finding can be marked ✓ confirmed / ✗ false positive /
  ⊘ ignored (and reopened), with a status filter bar, triage progress
  ("triaged 5/18"), badges in the list, and triage state in Markdown/JSON exports.
  `PATCH /api/findings/:id`.

### Changed
- **Quick hunts are much faster**: thinking level LOW on Gemini 3.x (fast triage)
  instead of the default MEDIUM; deep hunts keep HIGH.

## [1.0.3] — 2026-11-18

### Fixed
- **Hunts aborted on any rate limit**: every Gemini 429 body says "Quota
  exceeded", and the daily-quota detector matched that text — so a routine
  per-minute rate limit was misclassified as daily exhaustion and killed the
  whole hunt. Detection now reads Google's actual `quotaId`: `PerDay` → daily,
  `limit: 0` → model has no quota on this tier, otherwise per-minute →
  honor `RetryInfo` and retry.

### Added
- **Model fallback mid-hunt**: Gemini quotas are per model, so when a model's
  daily bucket runs dry the hunt probes and hops to the next available model
  instead of failing. The hunt page shows the model actually used; the error
  lists every model tried only if all are exhausted.

## [1.0.2] — 2026-11-18

### Fixed
- **Hunts failed for new Gemini keys**: Google deprecated `gemini-2.5-flash`/`2.5-pro`
  (Nov 2) and closed them to keys created after Sep 18, 2026 — VEX's default model
  was uncalled-for new users. VEX now defaults to `gemini-3.5-flash-lite` (hunt) and
  `gemini-3.8-flash` (deep), refreshes the key's model list at every hunt start,
  and probes up to 3 candidate models before scanning — failing fast with the real
  error instead of after a full scan.
- Failed scans now show the actual Gemini API error message instead of a generic
  "check your key and quota" banner.

### Changed
- Gemini 3 API request shape: `thinking_level` (LOW/MEDIUM/HIGH) replaces
  `thinking_budget`; `temperature`/`top_p` are no longer sent to 3.x models
  (removed by Google).
- Deep scans throttle to ~4.6 req/min (3.8 Flash free tier is 5 RPM).

## [1.0.1] — 2026-11-18

### Fixed
- **Windows support**: `npm start` no longer uses bash-only `${PORT:-3000}`
  syntax (broke on PowerShell/cmd). Custom ports still work via the `PORT`
  env var on all platforms.
- `npm start` now builds before serving, so a fresh clone works with a single
  command as the README promises.

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
