# Contributing to VEX

Thanks for your interest in making VEX sharper. This document covers how to set up,
build, test, and propose changes.

> Note: VEX is source-available under a personal-use license. By submitting a
> contribution you agree it is licensed under the [LICENSE](./LICENSE) terms
> (see clause 7, "Contributions").

## Prerequisites

- **Node.js ≥ 22.5** (VEX uses the built-in `node:sqlite` module)
- A **GitHub token** (fine-grained PAT with *Contents: Read-only*)
- A **Gemini API key** — *or* use mock mode, no key needed (see below)

## Setup

```bash
git clone https://github.com/mafk21/VEX.git
cd VEX
npm install
npm run dev
```

Open http://localhost:3000, connect your token + key, and you're in.

### Demo without a Gemini key

```bash
VEX_MOCK_GEMINI=1 npm run dev       # macOS/Linux
$env:VEX_MOCK_GEMINI="1"; npm run dev   # Windows PowerShell
```

Mock mode runs the entire pipeline (tree fetch → filtering → chunking → worker →
findings → report UI) with clearly-labeled canned findings. All engine and UI
contributions can be developed this way.

## Testing

```bash
npm test          # unit tests (node:test + type-stripped TS, no extra deps)
npm run build     # type-check + production build — must pass before submitting
```

- Tests live in `tests/*.test.ts` and import the pure logic in `src/lib/`.
- If you change filtering, packing, or parsing logic, add or update a test.

## Project layout

```
src/
  app/            Next.js routes (pages + API handlers)
  components/     client UI (report, code viewer, onboarding, …)
  lib/            engine: github, gemini, scanner, filter, packer, prompt, db, config
tests/            unit tests
PLAN.md           sprint plan & architecture decisions
```

## Guidelines

- **Local-first is sacred.** No telemetry, no external services beyond the user's
  direct GitHub and Gemini calls. Any new network call needs a strong justification.
- **Never log or transmit key material.** `getStatus()` and the API must never
  return tokens or keys.
- **Fail with clear messages.** Users see errors in the UI — make them actionable.
- Keep the code TypeScript-strict; `npm run build` must pass clean.
- Commit messages: short, imperative mood, e.g. `filter: skip .min.js bundles`.

## Proposing changes

1. Open an issue first for anything non-trivial — describe the problem, not just
   the solution.
2. Fork, branch, commit, and open a PR against `main`.
3. Keep PRs focused; one concern per PR.
4. Describe how you tested it (mock mode is fine).

Bug reports: include your OS, Node version, what you scanned (size/language),
the exact error shown, and server console output with any keys redacted.
