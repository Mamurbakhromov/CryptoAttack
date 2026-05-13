import type { NormalizedEvent } from '../types';
import { formatDateTime, formatLatency, formatTime } from './format';

interface EventTimelineProps {
  title: string;
  subtitle: string;
  events: NormalizedEvent[];
  maxVisible?: number;
  highlightedIds: Set<string>;
}

export function EventTimeline({ title, subtitle, events, maxVisible = 20, highlightedIds }: EventTimelineProps) {
  const visible = events.slice(0, maxVisible);

  return (
    <section className="panel min-h-[340px]">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span className="count-pill">{events.length}</span>
      </div>

      <div className="space-y-3">
        {visible.length ? (
          visible.map((event) => <EventCard key={event.id} event={event} highlighted={highlightedIds.has(event.id)} />)
        ) : (
          <div className="empty-state">Waiting for live events</div>
        )}
      </div>
    </section>
  );
}

export function EventCard({ event, highlighted }: { event: NormalizedEvent; highlighted: boolean }) {
  return (
    <article className={`event-card ${highlighted ? 'event-flash' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-black text-white">{event.title}</h3>
        <span className={`severity ${event.severity}`}>{event.severity}</span>
      </div>

      <p className="event-text mt-2">{event.plainText || 'No text payload'}</p>
      <EventLinks event={event} />

      <EventMeta event={event} />
    </article>
  );
}

function EventLinks({ event }: { event: NormalizedEvent }) {
  const links = extractSafeLinks(event).slice(0, 4);
  if (!links.length) return null;

  return (
    <div className="event-links mt-2 flex flex-wrap gap-2">
      {links.map((link) => (
        <a href={link.href} key={link.href} rel="noreferrer noopener" target="_blank">
          {link.label}
        </a>
      ))}
    </div>
  );
}

export function EventMeta({ event }: { event: NormalizedEvent }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-slate-300">
      <span className="chip">{event.endpoint}</span>
      <span className="chip">{event.chapter}/{event.category}</span>
      <span className="chip">received {formatTime(event.receivedAt)}</span>
      <span className="chip">source {formatDateTime(event.timestamp)}</span>
      <span className="chip">latency {formatLatency(event.latencyMs)}</span>
      {event.parserStatus === 'parser_needs_sample' ? <span className="chip warn">Parser needs sample</span> : null}
      {event.filters.slice(0, 8).map((filter) => (
        <span className="chip" key={`${event.id}-filter-${filter}`}>filter: {filter}</span>
      ))}
      {event.coins.slice(0, 10).map((coin) => (
        <button className="coin-chip" key={`${event.id}-coin-${coin}`} type="button" onClick={() => copyCoin(coin)}>
          {coin}
        </button>
      ))}
    </div>
  );
}

function copyCoin(coin: string): void {
  void navigator.clipboard?.writeText(coin);
}

function extractSafeLinks(event: NormalizedEvent): Array<{ href: string; label: string }> {
  const links = new Map<string, string>();

  if (typeof DOMParser !== 'undefined' && event.htmlText) {
    const doc = new DOMParser().parseFromString(event.htmlText, 'text/html');
    for (const anchor of doc.querySelectorAll('a[href]')) {
      const href = normalizeSafeUrl(anchor.getAttribute('href'));
      if (!href) continue;
      links.set(href, anchor.textContent?.trim() || new URL(href).hostname);
    }
  }

  const urlMatches = event.plainText.match(/https?:\/\/[^\s<>()"']+/g) ?? [];
  for (const match of urlMatches) {
    const href = normalizeSafeUrl(match.replace(/[.,;:!?]+$/, ''));
    if (href && !links.has(href)) links.set(href, new URL(href).hostname);
  }

  return [...links.entries()].map(([href, label]) => ({ href, label }));
}

function normalizeSafeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
