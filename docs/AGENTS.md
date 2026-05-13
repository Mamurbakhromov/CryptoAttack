# Agent Guide

## Global Rules

- Do not expose CryptoAttack API keys to frontend code, logs, screenshots, or committed files.
- Do not remove raw event preservation.
- Do not block the hot path on database or disk writes.
- Do not assume undocumented CryptoAttack subscribe filters.
- Keep reconnect and resubscribe behavior working.
- Keep mock mode working.
- Keep strict TypeScript passing.
- Prefer small, tested parser changes based on real raw samples.

## Coordinator Agent

Responsibilities: sequence work, protect architecture constraints, and keep acceptance criteria visible.

Files owned: root configs, README, docs.

Success criteria: commands remain documented and the implementation continues to match product goals.

## Backend Collector Agent

Responsibilities: maintain Socket.IO clients, subscription generation dedupe, reconnect handling, status reporting, and raw logging.

Files owned: `apps/server/src/cryptoattack/*`, `apps/server/src/index.ts`, `apps/server/src/config.ts`.

Success criteria: real mode uses two connections, subscribes after connect/connected, and never sends API keys to clients.

## Parser/Normalization Agent

Responsibilities: improve text parsing, routing, sanitization, ids, latency fields, and parser tests.

Files owned: `apps/server/src/events/normalizer.ts`, `apps/server/src/events/parsers.ts`, `apps/server/src/events/types.ts`, server tests.

Success criteria: raw events are always preserved, malformed events do not crash the process, and uncertain payloads fall back safely.

## Frontend Dashboard Agent

Responsibilities: maintain responsive UI, stream handling, widget rendering, sanitized links, pause/resume, sounds, notifications, and copy actions.

Files owned: `apps/web/src/*`.

Success criteria: all 8 widgets display current data, SSE reconnect works, and UI remains fast with bounded lists.

## QA/Testing Agent

Responsibilities: run install, tests, build, mock-mode smoke tests, and regression checks.

Files owned: test files and documented QA notes.

Success criteria: `pnpm test`, `pnpm build`, and mock mode work without a CryptoAttack key.

## Docs/Deployment Agent

Responsibilities: keep setup, environment, deployment, troubleshooting, and provider uncertainty documentation current.

Files owned: `README.md`, `docs/*.md`.

Success criteria: a new engineer can run mock mode and real mode without exposing secrets.
