import type { NormalizedEvent } from '../types';
import { formatMoney, formatTime } from './format';

interface MetricCardProps {
  title: string;
  description: string;
  event: NormalizedEvent | null;
  accent: 'cyan' | 'violet' | 'emerald' | 'amber';
  highlighted: boolean;
  compact?: boolean;
}

export function MetricCard({ title, description, event, accent, highlighted, compact = false }: MetricCardProps) {
  const metric = event?.amountMetric;
  const value = metric?.status === 'ok' ? formatMoney(metric.totalUsd) : metric?.message ?? 'Waiting';

  return (
    <article className={`metric-card ${accent} ${highlighted ? 'event-flash' : ''}`}>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{title}</p>
        <strong className="mt-3 block text-3xl font-black tracking-[-0.05em] text-white md:text-4xl">{value}</strong>
      </div>
      {compact ? null : <p className="mt-3 text-sm text-slate-400">{description}</p>}
      {event && !compact ? (
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold text-slate-300">
          <span className="chip">{formatTime(event.receivedAt)}</span>
          <span className="chip">entries: {metric?.entryCount ?? event.entries.length}</span>
          {event.parserStatus === 'parser_needs_sample' ? <span className="chip warn">Parser needs sample</span> : null}
        </div>
      ) : null}
    </article>
  );
}
