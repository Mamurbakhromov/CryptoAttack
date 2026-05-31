# Architecture

## System Diagram

```text
CryptoAttack wss.cryptoattack.net
CryptoAttack wss2.cryptoattack.net
        |
        v
Node.js Fastify backend
  Socket.IO collector
  subscription manager
  normalizer and parser
  TTL dedupe
  in-memory ring buffers
  async raw NDJSON logger
        |
        +--> REST: health/status/snapshot/events
        +--> SSE: normalized events/status/heartbeat
        |
        v
React Vite dashboard
```

## Backend Architecture

- `config.ts` parses environment variables with Zod.
- `cryptoattack/client.ts` owns real Socket.IO clients and reconnect/resubscribe behavior.
- `cryptoattack/subscriptions.ts` contains the endpoint and category mapping.
- `events/normalizer.ts` maps raw CryptoAttack payloads to dashboard feed keys.
- `events/parsers.ts` contains conservative text, HTML, top-list, amount, and routing helpers.
- `events/eventStore.ts` keeps ring buffers, dedupe state, socket status, counters, and latency stats.
- `http/routes.ts` exposes REST endpoints.
- `http/sse.ts` streams snapshots, events, statuses, and heartbeats.
- `mock/mockCryptoAttack.ts` generates local mock events.

## Frontend Architecture

- Vite serves the React app in development and proxies `/api` to Fastify.
- `api/sse.ts` wraps browser EventSource.
- `App.tsx` owns stream state, pause/resume buffering, sound, and notifications.
- Dashboard components render status, timelines, top tables, metric cards, and raw/unclassified events.
- The UI keeps only bounded recent rows visible per widget.

## CryptoAttack Connection Strategy

- Fast endpoint: `CRYPTOATTACK_FAST_URL`, default `https://wss2.cryptoattack.net`.
- Main endpoint: `CRYPTOATTACK_MAIN_URL`, default `https://wss.cryptoattack.net`.
- Both clients use `transports: ['websocket']` and automatic reconnection.
- Subscriptions are attempted on CryptoAttack `connected` events with a short `connect` fallback.
- Subscription attempts are deduplicated per connection generation.
- `cex_alerts/delistings` and `signals/oi_alerts` are implemented from the documented category list.

## Event Lifecycle

```text
Socket.IO news payload
  -> normalize text, HTML, coins, filters, ids, timestamps
  -> route to one or more feed keys
  -> dedupe by normalized id
  -> store in feed ring buffer
  -> emit SSE immediately
  -> enqueue raw NDJSON append asynchronously
```

## Deduplication Strategy

- Raw CryptoAttack `id` is used when present.
- If `id` is missing, a stable SHA-256 hash is created from chapter, category, text, timestamp, and time fields.
- Derived events add the feed key to the normalized id so amount metrics can coexist with top-list events.
- Deduplication entries expire after `DEDUPE_TTL_MS`.

## Normalization Strategy

- `texts` accepts mixed string and false values.
- `coins` accepts false, string, or array.
- `filters` accepts missing or array values.
- Time is derived from `time`, `timesend1`, or ISO `timestamp`.
- HTML is sanitized to safe anchors and line breaks.
- Unclear or malformed events are preserved in `raw_unclassified`.

## SSE API

- `GET /api/stream` returns an SSE stream.
- Initial events: `snapshot`, then `status`.
- Live events: `event` for normalized events and `status` for socket state changes.
- Heartbeat: every 15 seconds.
- Auth: query `token`, `Authorization: Bearer`, or `x-dashboard-token` when enabled.

## Deployment Notes

- Run Node.js 24 or newer.
- Deploy near CryptoAttack endpoints for lower network latency.
- Serve behind HTTPS with Caddy, Nginx, Fly, Render, Railway, or similar.
- Keep `.env` private and never put real API keys in frontend env files.
- Build the web app before production start if the backend should serve static assets.

## Failure Modes And Recovery

- Socket.IO disconnect: status updates, automatic reconnect, generation reset, resubscribe.
- Stale category stream: connected sockets periodically refresh subscriptions with `CRYPTOATTACK_RESUBSCRIBE_INTERVAL_MS`.
- Malformed payload: event is preserved as raw/unclassified and process continues.
- Raw log write failure: warning is logged, live delivery continues.
- SSE disconnect: browser EventSource reconnects automatically.
- Auth failure: API/SSE returns 401 without revealing backend details.

## Future Improvements

- Add confirmed CryptoAttack subscribe filter fields after provider documentation.
- Add persistent historical storage outside the live hot path.
- Add parser samples from real raw NDJSON payloads.
- Add deployment templates and latency dashboards.
