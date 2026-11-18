# Security Policy

VEX is a security tool, so we take its own security seriously.

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

Instead, contact the maintainer privately via the GitHub profile of
[@mafk21](https://github.com/mafk21) (use the contact options listed there), and
include:

- A description of the vulnerability and its impact
- Steps to reproduce (a minimal proof of concept helps enormously)
- Affected version/commit

You can expect an acknowledgment within a few days. We'll coordinate a fix and
disclose responsibly once a patch is available.

## Scope notes

- VEX runs entirely on your machine. There is no hosted service to attack.
- Your keys are stored AES-256-GCM encrypted in `~/.vex/config.json` (mode 0600)
  and findings in a local SQLite database. **Never** commit your `.vex/`
  directory or share your config file.
- VEX sends code you scan to Google's Gemini API using **your own key**. Free-tier
  keys may allow Google to use prompts for training — see the README. That's a
  property of Google's API terms, not something VEX can change; use a paid key
  for sensitive code.
- VEX itself never phones home and has no telemetry. If you find any network
  call beyond `api.github.com` and `generativelanguage.googleapis.com`, that's a
  bug — report it.
