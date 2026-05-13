export function formatTime(value: string | null | undefined): string {
  if (!value) return 'Waiting';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(parsed);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Waiting';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(parsed);
}

export function formatMoney(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'Waiting';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    notation: value >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1_000_000 ? 2 : 0
  }).format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'Waiting';
  return new Intl.NumberFormat(undefined).format(value);
}

export function formatLatency(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'Waiting';
  return `${Math.round(value)} ms`;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
