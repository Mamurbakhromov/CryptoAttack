export interface WorkerStatus {
  enabled: boolean;
  state: 'disabled' | 'running' | 'degraded' | 'stopped';
  running: boolean;
  activeCoinCount: number;
  intervalMs: number;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  processed: number;
  written: number;
  skipped: number;
  failed: number;
  averageRunMs: number | null;
}

export function disabledWorkerStatus(intervalMs: number): WorkerStatus {
  return {
    enabled: false,
    state: 'disabled',
    running: false,
    activeCoinCount: 0,
    intervalMs,
    lastRunStartedAt: null,
    lastRunCompletedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    processed: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    averageRunMs: null
  };
}
