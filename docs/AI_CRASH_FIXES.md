# AI Crash/Bug Fix Assistance

TruckExpoAI uses Sentry for crash capture and a guarded GitHub workflow for AI-assisted fixes.

## Flow

1. The React Native app sends JS/native crashes to Sentry when `SENTRY_DSN` is configured.
2. Sentry links the event to GitHub through the Sentry GitHub integration and source-code mapping.
3. A GitHub issue labeled `crash-report` triggers `.github/workflows/crash-doctor.yml`.
4. The workflow runs `.github/scripts/crash_doctor.py`, asks Claude for a minimal patch, creates a `codex/crash-fix-<issue>` branch, and opens a PR.
5. A human reviews and merges. The workflow never auto-merges.

## Required Secrets

Set these in GitHub repository secrets:

- `ANTHROPIC_API_KEY` — used by Crash Doctor to generate the patch.
- `SENTRY_AUTH_TOKEN` — optional for release/source-map workflows if added later.

Set this in the mobile `.env` / release build environment:

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT=production`

## Sentry Setup Checklist

- Connect Sentry to GitHub from Sentry Settings -> Integrations -> GitHub.
- Add code mappings for this repository so stack traces resolve to `src/...` and `backend/...`.
- Configure Sentry alerts to create or link GitHub issues for high-frequency crashes.
- Add the GitHub label `crash-report` to issues that should trigger an AI fix PR.

## Guardrails

- Minimal diff only.
- No direct commits to `main`.
- No auto-merge.
- No new dependencies from Crash Doctor patches.
- Keep Android/iOS/Gradle, Railway config, DB schema, and API keys off-limits unless a human explicitly approves.
