import type { NormalizedEvent } from '../types';

const ONE_HOUR_MS = 60 * 60 * 1_000;

export function countCoinHitsLastHour(events: NormalizedEvent[], referenceEvent: NormalizedEvent | null): Map<string, number> {
  const referenceMs = parseTime(referenceEvent?.receivedAt) ?? Date.now();
  const cutoffMs = referenceMs - ONE_HOUR_MS;
  const counts = new Map<string, number>();

  for (const event of events) {
    const eventMs = parseTime(event.receivedAt);
    if (eventMs === null || eventMs < cutoffMs || eventMs > referenceMs) continue;

    const coinsInEvent = new Set<string>();
    for (const entry of event.entries) {
      if (entry.coin) coinsInEvent.add(entry.coin);
    }

    for (const coin of coinsInEvent) {
      counts.set(coin, (counts.get(coin) ?? 0) + 1);
    }
  }

  return counts;
}

export function formatHitCount(coin: string | null, hits: Map<string, number>): string {
  if (!coin) return '-';
  return String(hits.get(coin) ?? 0);
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
