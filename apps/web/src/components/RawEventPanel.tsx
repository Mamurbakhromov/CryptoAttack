import type { NormalizedEvent } from '../types';
import { EventCard } from './EventTimeline';

interface RawEventPanelProps {
  title: string;
  events: NormalizedEvent[];
  compact?: boolean;
}

export function RawEventPanel({ title, events, compact = false }: RawEventPanelProps) {
  return (
    <section className={`panel ${compact ? '' : 'xl:col-span-2'}`}>
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>Preserved payloads for parser tuning and provider uncertainty.</p>
        </div>
        <span className="count-pill">{events.length}</span>
      </div>

      <div className="space-y-3">
        {events.length ? (
          events.slice(0, compact ? 1 : 8).map((event) => (
            <div className="space-y-3" key={event.id}>
              <EventCard event={event} highlighted={false} />
              <pre className="raw-block">{safeRaw(event.raw)}</pre>
            </div>
          ))
        ) : (
          <div className="empty-state">No unclassified events yet</div>
        )}
      </div>
    </section>
  );
}

function safeRaw(raw: unknown): string {
  try {
    return JSON.stringify(raw, null, 2).slice(0, 5_000);
  } catch {
    return '[unserializable raw payload]';
  }
}
