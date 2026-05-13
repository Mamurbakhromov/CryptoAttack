# Product Requirements Document

## Problem Statement

CryptoAttack delivers time-sensitive market alerts over Socket.IO. Traders need a very fast local dashboard that receives, normalizes, deduplicates, and displays those alerts without exposing the CryptoAttack API key to browser code.

## User Goals

- See listings, delistings, top buying coins, buy amount metrics, OI gainers, and OI alerts as soon as they arrive.
- Develop and test the dashboard locally without a real API key.
- Preserve raw payloads so parser rules can be improved when real samples arrive.
- Keep frontend updates fast and resilient to reconnects.

## Dashboard Widgets

- Listings
- Delistings
- Top 10 buying coins in all derivatives in last 5 minutes
- Top 10 buying coins on all spot in last 5 minutes
- All spot amount buying
- Top 10 OI Gainers
- All derivatives amount buying
- OI Alerts
- Raw/unclassified debugging panel

## Functional Requirements

- Backend connects to CryptoAttack using Socket.IO with `transports: ['websocket']`.
- Backend uses two CryptoAttack connections: main and fast Japan endpoint.
- Backend subscribes using only documented `chapter` and `category` fields by default.
- Optional future subscribe payload fields can be added through config.
- Backend normalizes raw payload variations, including missing `id`, missing time fields, false values in `texts`, false `coins`, and missing `filters`.
- Backend deduplicates events by normalized id with configurable TTL.
- Backend exposes `/health`, `/api/status`, `/api/snapshot`, `/api/events`, and `/api/stream`.
- Frontend consumes SSE, reconnects automatically, and displays all required widgets.
- Mock mode generates realistic events for every widget without connecting to CryptoAttack.

## Non-Functional Requirements

- Hot path must not depend on a database.
- Disk raw-event logging must not block live delivery.
- Strict TypeScript is required across backend and frontend.
- The UI must remain responsive on desktop and mobile.
- Reconnect and resubscribe behavior must recover automatically.

## Latency Expectations

- Server should push normalized events to SSE clients immediately after in-memory storage.
- Latency is measured when CryptoAttack provides `time`, `timesend1`, or `timestamp`.
- UI should highlight new events without expensive rendering or large DOM lists.

## Security Requirements

- Never expose `CRYPTOATTACK_API_KEY` to the frontend.
- Never commit a real API key.
- Add `.env` to `.gitignore`.
- Sanitize event HTML before rendering links.
- Require `DASHBOARD_AUTH_TOKEN` for API and SSE when dashboard auth is enabled.

## MVP Scope

- Socket.IO collector.
- In-memory store and dedupe.
- Conservative parser and normalization rules.
- SSE and REST API.
- React dashboard with all required widgets.
- Mock mode.
- Vitest coverage for store, normalizer, and parser fallback behavior.

## Out Of Scope

- Persistent database storage.
- Trading actions or exchange order placement.
- Multi-user role management.
- Advanced alert rule builder.
- Confirmed CryptoAttack category-specific filter schemas until provider documents them.

## Acceptance Criteria

- `pnpm install` works.
- `pnpm dev` starts backend and frontend.
- `MOCK_CRYPTOATTACK=true` produces live dashboard updates without an API key.
- Real mode connects and subscribes when `CRYPTOATTACK_API_KEY` is set.
- Frontend never receives the CryptoAttack API key.
- Dashboard shows all 8 required widgets.
- SSE reconnect works in the browser.
- Socket.IO reconnect resubscribes.
- Duplicate events do not appear twice.
- Raw events are preserved.
- Tests pass.
- README and docs are complete.
