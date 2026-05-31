import type { FastifyReply, FastifyRequest } from 'fastify';

import type { DurableIngestionStatus } from '../db/durableIngestion.js';
import type { SpotPerformanceService } from '../exchanges/spotPerformance.js';
import type { SpotPerformanceResponse } from '../exchanges/types.js';
import type { EventStore } from '../events/eventStore.js';
import type { ApiStatus, NormalizedEvent } from '../events/types.js';

interface SseClient {
  id: number;
  reply: FastifyReply;
}

interface SseHubOptions {
  corsOrigin: string;
  getStorageStatus?: () => StorageStatusSseEvent | null;
}

export interface StorageStatusSseEvent {
  generatedAt: string;
  storage: DurableIngestionStatus;
}

export class SseHub {
  private readonly clients = new Map<number, SseClient>();
  private nextClientId = 1;
  private readonly heartbeatTimer: NodeJS.Timeout;
  private latestStorageStatus: StorageStatusSseEvent | null = null;
  private readonly onStoreEvent = (event: NormalizedEvent) => {
    this.broadcast('event', event);
  };
  private readonly onStoreStatus = (status: ApiStatus) => {
    this.broadcast('status', status);
  };
  private readonly onSpotPerformanceUpdate = (response: SpotPerformanceResponse) => {
    this.broadcast('spot-performance', response);
  };

  constructor(
    private readonly store: EventStore,
    private readonly options: SseHubOptions,
    private readonly spotPerformance?: SpotPerformanceService
  ) {
    this.store.on('event', this.onStoreEvent);
    this.store.on('status', this.onStoreStatus);
    this.spotPerformance?.on('update', this.onSpotPerformanceUpdate);

    this.heartbeatTimer = setInterval(() => {
      this.broadcast('heartbeat', { now: new Date().toISOString() });
    }, 15_000);
    this.heartbeatTimer.unref();
  }

  handleStream(request: FastifyRequest, reply: FastifyReply): void {
    reply.hijack();
    const corsOrigin = getCorsOrigin(request.headers.origin, this.options.corsOrigin);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin, Vary: 'Origin' } : {})
    });

    const client: SseClient = {
      id: this.nextClientId,
      reply
    };
    this.nextClientId += 1;
    this.clients.set(client.id, client);

    reply.raw.write('retry: 2000\n\n');
    this.send(client, 'snapshot', this.store.getSnapshot());
    this.send(client, 'status', this.store.getStatus());
    for (const response of this.spotPerformance?.getCachedPerformanceResponses() ?? []) {
      this.send(client, 'spot-performance', response);
    }
    const storageStatus = this.latestStorageStatus ?? this.options.getStorageStatus?.() ?? null;
    if (storageStatus) this.send(client, 'storage-status', storageStatus);
    this.send(client, 'heartbeat', { now: new Date().toISOString() });

    request.raw.once('close', () => {
      this.clients.delete(client.id);
    });
  }

  close(): void {
    clearInterval(this.heartbeatTimer);
    this.store.off('event', this.onStoreEvent);
    this.store.off('status', this.onStoreStatus);
    this.spotPerformance?.off('update', this.onSpotPerformanceUpdate);
    for (const client of this.clients.values()) {
      client.reply.raw.end();
    }
    this.clients.clear();
  }

  broadcastStorageStatus(event: StorageStatusSseEvent): void {
    this.latestStorageStatus = event;
    this.broadcast('storage-status', event);
  }

  broadcastSnapshot(): void {
    this.broadcast('snapshot', this.store.getSnapshot());
  }

  private broadcast(eventName: string, data: unknown): void {
    for (const client of this.clients.values()) {
      this.send(client, eventName, data);
    }
  }

  private send(client: SseClient, eventName: string, data: unknown): void {
    const payload = JSON.stringify(data);
    try {
      const ok = client.reply.raw.write(`event: ${eventName}\ndata: ${payload}\n\n`);
      if (!ok && client.reply.raw.destroyed) {
        this.clients.delete(client.id);
      }
    } catch {
      this.clients.delete(client.id);
    }
  }
}

function getCorsOrigin(requestOrigin: string | undefined, allowedOrigin: string): string | null {
  if (allowedOrigin === '*') return '*';
  if (!requestOrigin) return allowedOrigin;
  return requestOrigin === allowedOrigin ? requestOrigin : null;
}
