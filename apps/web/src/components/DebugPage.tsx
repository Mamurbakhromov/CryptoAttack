import type { ApiStatus, ConnectionStatus, DashboardSnapshot, StreamState, SubscriptionStatus } from '../types';
import { formatDateTime, formatLatency } from './format';
import { RawEventPanel } from './RawEventPanel';

interface DebugPageProps {
  snapshot: DashboardSnapshot;
  status: ApiStatus | null;
  streamState: StreamState;
}

export function DebugPage({ snapshot, status, streamState }: DebugPageProps) {
  const sockets = Object.values(status?.sockets ?? {});
  const subscriptions = sockets.flatMap((socket) => socket.subscriptions.map((subscription) => ({ socket, subscription })));

  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <section className="page-hero debug">
        <h1>Debug</h1>
        <span>Raw fallbacks, socket health, and subscription payloads</span>
      </section>

      <section className="grid gap-3 xl:grid-cols-4">
        <DebugStat label="Stream" value={streamState} />
        <DebugStat label="Stored" value={String(snapshot.counters.stored)} />
        <DebugStat label="Deduped" value={String(snapshot.counters.deduplicated)} />
        <DebugStat label="Latency" value={formatLatency(snapshot.latency.latestMs ?? snapshot.latency.averageMs)} />
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        {sockets.length ? sockets.map((socket) => <SocketCard socket={socket} key={socket.name} />) : <div className="empty-state">Waiting for socket status</div>}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Subscriptions</h2>
            <p>Last subscribe attempts and payload previews for each CryptoAttack endpoint.</p>
          </div>
          <span className="count-pill">{subscriptions.length}</span>
        </div>
        {subscriptions.length ? (
          <div className="overflow-hidden rounded-2xl border border-slate-800/80">
            <table className="w-full table-fixed text-left text-[11px] xl:text-xs">
              <thead className="bg-slate-950/70 text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:text-[10px]">
                <tr>
                  <th className="w-[10%] px-2 py-2">Endpoint</th>
                  <th className="w-[22%] px-2 py-2">Category</th>
                  <th className="w-[10%] px-2 py-2">State</th>
                  <th className="w-[10%] px-2 py-2">Attempts</th>
                  <th className="w-[18%] px-2 py-2">Last Attempt</th>
                  <th className="w-[30%] px-2 py-2">Payload / Notes</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map(({ socket, subscription }) => <SubscriptionRow socket={socket} subscription={subscription} key={`${socket.name}-${subscription.key}`} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">No subscriptions reported yet</div>
        )}
      </section>

      <RawEventPanel title="Raw / Unclassified Events" events={snapshot.feeds.raw_unclassified.events} />
    </main>
  );
}

function DebugStat({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card cyan">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <strong className="mt-3 block text-2xl font-black tracking-[-0.04em] text-white">{value}</strong>
    </article>
  );
}

function SocketCard({ socket }: { socket: ConnectionStatus }) {
  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <h2>{socket.name}</h2>
          <p>{socket.url}</p>
        </div>
        <span className={`status-pill ${socket.serverConnected ? 'ok' : socket.connected ? 'warn' : 'bad'}`}>{socket.serverConnected ? 'connected' : socket.connected ? 'socket open' : 'offline'}</span>
      </div>
      <div className="grid gap-2 text-xs font-bold text-slate-300 md:grid-cols-2">
        <span className="chip">transport: {socket.transport ?? 'waiting'}</span>
        <span className="chip">socket: {socket.socketId ?? 'none'}</span>
        <span className="chip">generation: {socket.generation}</span>
        <span className="chip">subscriptions: {socket.subscriptionCount}</span>
        <span className="chip">last connect: {formatDateTime(socket.lastConnectedAt)}</span>
        <span className="chip">last news: {formatDateTime(socket.lastNewsAt)}</span>
        {socket.lastError ? <span className="chip warn">error: {socket.lastError}</span> : null}
      </div>
    </article>
  );
}

function SubscriptionRow({ socket, subscription }: { socket: ConnectionStatus; subscription: SubscriptionStatus }) {
  return (
    <tr className="border-t border-slate-800/70">
      <td className="px-2 py-2 font-black text-slate-300">{socket.name}</td>
      <td className="px-2 py-2 font-bold text-cyan-100">{subscription.chapter}/{subscription.category}</td>
      <td className="px-2 py-2 font-bold text-slate-200">{subscription.state}</td>
      <td className="px-2 py-2 font-bold text-slate-200">{subscription.attempts}</td>
      <td className="px-2 py-2 font-bold text-slate-300">{formatDateTime(subscription.lastAttemptAt)}</td>
      <td className="px-2 py-2 text-slate-300">
        <code className="break-all text-[10px]">{safeJson(subscription.payloadPreview)}</code>
        {subscription.needsConfirmation ? <span className="ml-2 text-amber-200">needs confirmation</span> : null}
        {subscription.notes ? <div className="mt-1 text-[10px] text-slate-400">{subscription.notes}</div> : null}
      </td>
    </tr>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}
