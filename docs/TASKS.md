# Tasks

## Coordinator Assessment

- Repository is not empty and already uses a compatible `pnpm` workspace.
- Root package is `cryptoattack-realtime-dashboard` with Node.js `>=24` and scripts for `dev`, `build`, `start`, `test`, `typecheck`, and `lint`.
- Backend app is `apps/server` using Fastify, Socket.IO client, Pino, Zod, TypeScript, and Vitest.
- Frontend app is `apps/web` using Vite, React, TypeScript, Tailwind CSS, and Vitest.
- `.env` is ignored by git, and `.env.example` contains placeholders only.
- Current architecture matches the required flow: CryptoAttack Socket.IO -> backend collector -> in-memory event store -> SSE -> React dashboard.
- No undocumented CryptoAttack category filter schema should be added unless provider documentation confirms it.

## Milestone 1: Repo Scaffold And Documentation

- [x] Use `pnpm` workspaces with `apps/server` and `apps/web`.
- [x] Add strict shared TypeScript base config.
- [x] Add `.env.example` with no real API key.
- [x] Ensure `.env`, `data/`, `dist/`, and `node_modules/` are ignored.
- [x] Document setup, mock mode, real API mode, security, troubleshooting, and provider uncertainties in `README.md`.
- [x] Maintain PRD, architecture, tasks, and agent docs under `docs/`.

## Milestone 2: Backend Configuration And Runtime Skeleton

- [x] Parse environment variables with Zod in `apps/server/src/config.ts`.
- [x] Keep CryptoAttack API key backend-only.
- [x] Define default endpoints for main and fast CryptoAttack Socket.IO URLs.
- [x] Include config extension point for future confirmed subscribe payload extras.
- [x] Provide mock mode that does not require a CryptoAttack API key.

## Milestone 3: CryptoAttack Collector

- [x] Create one main Socket.IO client and one fast Socket.IO client.
- [x] Authenticate with `auth: { apiKey }` only from backend environment.
- [x] Subscribe after CryptoAttack `connected` event, with reconnect recovery.
- [x] Subscribe to `cex_alerts/listings` on fast endpoint.
- [x] Subscribe to documented `cex_alerts/delistings` on fast endpoint.
- [x] Subscribe to `cex_alerts/all_derivatives_top`, `cex_alerts/all_spot_top`, `market_data/top_oi`, and `signals/oi_alerts` on main endpoint.
- [x] Do not add undocumented buy, sell, 5m, gainer, threshold, or exchange filters to subscribe payloads by default.

## Milestone 4: Event Store, Normalization, And Parsing

- [x] Define raw and normalized event types.
- [x] Preserve raw events for every stored normalized event.
- [x] Normalize text, HTML, coins, filters, ids, timestamps, source time, receive time, and latency.
- [x] Dedupe by event id with TTL.
- [x] Use bounded in-memory buffers per feed key.
- [x] Route buy/5m and OI gainer classifications locally from `payload.filters` and text.
- [x] Keep unknown or malformed events in `raw_unclassified`.
- [ ] Improve top-list and amount parsers after collecting real CryptoAttack raw samples.

## Milestone 5: REST And SSE API

- [x] Add `/health`.
- [x] Add `/api/status`.
- [x] Add `/api/snapshot`.
- [x] Add `/api/events`.
- [x] Add `/api/stream` SSE with initial snapshot, event updates, status updates, and heartbeat.
- [x] Support optional dashboard auth without exposing CryptoAttack credentials.

## Milestone 6: Frontend Dashboard

- [x] Build React dashboard using SSE from backend only.
- [x] Display Listings.
- [x] Display Delistings.
- [x] Display Top 10 buying coins in all derivatives in last 5 minutes.
- [x] Display Top 10 buying coins on all spot in last 5 minutes.
- [x] Display All spot amount buying.
- [x] Display Top 10 OI Gainers.
- [x] Display All derivatives amount buying.
- [x] Display OI Alerts.
- [x] Display raw/unclassified events for debugging.
- [x] Render sanitized HTML safely.
- [x] Keep visible lists bounded for dashboard speed.

## Milestone 7: Testing And Validation

- [x] Add Vitest tests for event store deduplication.
- [x] Add Vitest tests for normalizer routing.
- [x] Add Vitest tests for parser fallback behavior.
- [x] Add parser tests for USD amount formats, ranked row fallback, buy/5m rejection, and OI loser rejection.
- [x] Add event store tests for counters, snapshots, TTL dedupe behavior, and many-event safety.
- [x] Run `pnpm install`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.
- [x] Run `pnpm build`.
- [x] Run mock-mode API smoke test for `/health`, `/api/snapshot`, and `/api/stream`.
- [x] Run mock-mode frontend dev-server root smoke test.
- [x] Confirm frontend source does not reference `CRYPTOATTACK_API_KEY`.
- [x] Confirm built frontend does not reference `CRYPTOATTACK_API_KEY`.
- [x] Confirm production mock API and SSE responses do not expose API-key material.
- [x] Confirm optional dashboard auth protects API and SSE routes.
- [x] Confirm missing API key fails fast only when `MOCK_CRYPTOATTACK=false`.
- [ ] Run a real browser DOM/visual smoke test before demo.
- [ ] Run a real-mode connection smoke test only with a user-provided local `.env` API key.
- [x] Confirm frontend never receives `CRYPTOATTACK_API_KEY` through API responses or bundled code in local production-smoke mode.

## Milestone 8: Production Hardening

- [x] Keep raw NDJSON logging asynchronous and outside the live delivery hot path.
- [x] Confirm invalid raw NDJSON log path does not crash the server.
- [x] Serve built frontend from backend when `apps/web/dist` exists.
- [x] Add process manager examples for `pm2`.
- [x] Add reverse proxy and SSE buffering notes.
- [x] Add deployment checklist for low-latency VPS regions.
- [x] Add operational troubleshooting for no events, auth failures, SSE stalls, and parser gaps.

## Milestone 9: Provider Confirmation Items

- [x] Confirm whether `cex_alerts/delistings` is the exact production category name.
- [ ] Confirm whether category-specific subscribe filters are supported.
- [ ] If filters are supported, document exact payload schema before implementing config examples.
- [ ] Collect representative real payload samples for listings, delistings, top lists, OI gainers, and OI alerts.
- [ ] Update parser tests from real sanitized samples.

## Handoff Note For Next Agents

- Backend collector agents should focus on validating reconnect/resubscribe behavior against real CryptoAttack and must not leak the API key beyond server process memory.
- Parser agents should only improve classification from real `raw-events.ndjson` samples and must keep raw preservation and fallback behavior intact.
- Frontend agents should keep the browser connected only to backend REST/SSE endpoints and should continue rendering event HTML through the sanitized `htmlText` field.
- QA agents should run `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and a mock-mode smoke test before handoff.
- Docs/deployment agents should expand production runbooks and provider uncertainty notes without claiming undocumented CryptoAttack filter support.
