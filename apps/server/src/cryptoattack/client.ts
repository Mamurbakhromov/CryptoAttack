import { io, type Socket } from 'socket.io-client';

import type { AppConfig } from '../config.js';
import type { ConnectionStatus } from '../events/types.js';
import type { AppLogger } from '../utils/logger.js';
import {
  buildSubscribePayload,
  createSubscriptionStatus,
  getSubscriptions,
  subscriptionKey,
  type CryptoAttackSubscription,
  type EndpointName
} from './subscriptions.js';

export type RawEventHandler = (raw: unknown, endpointName: EndpointName) => void;
export type StatusHandler = (status: ConnectionStatus) => void;

export class CryptoAttackClient {
  private readonly sockets: Socket[] = [];
  private readonly subscriptionRefreshTimers: NodeJS.Timeout[] = [];
  private readonly subscriptions: Record<EndpointName, CryptoAttackSubscription[]>;
  private readonly statuses = new Map<EndpointName, ConnectionStatus>();
  private started = false;

  constructor(
    private readonly input: {
      config: AppConfig;
      logger: AppLogger;
      onRawEvent: RawEventHandler;
      onStatus?: StatusHandler;
    }
  ) {
    this.subscriptions = getSubscriptions(input.config);
  }

  start(): void {
    const { config, logger } = this.input;

    if (config.mockCryptoAttack) {
      logger.info('MOCK_CRYPTOATTACK=true; real CryptoAttack collector is disabled.');
      return;
    }

    if (!config.cryptoAttackApiKey) {
      throw new Error('CRYPTOATTACK_API_KEY is required when MOCK_CRYPTOATTACK=false');
    }

    if (this.started) return;
    this.started = true;

    this.initializeStatus('main', config.cryptoAttackMainUrl, this.subscriptions.main);
    this.initializeStatus('fast', config.cryptoAttackFastUrl, this.subscriptions.fast);
    this.connectEndpoint('main', config.cryptoAttackMainUrl, this.subscriptions.main);
    this.connectEndpoint('fast', config.cryptoAttackFastUrl, this.subscriptions.fast);
  }

  getStatus(): Record<EndpointName, ConnectionStatus> {
    return {
      main: cloneConnectionStatus(
        this.statuses.get('main') ??
          createInitialStatus('main', this.input.config.cryptoAttackMainUrl, !this.input.config.mockCryptoAttack, false, this.subscriptions.main)
      ),
      fast: cloneConnectionStatus(
        this.statuses.get('fast') ??
          createInitialStatus('fast', this.input.config.cryptoAttackFastUrl, !this.input.config.mockCryptoAttack, false, this.subscriptions.fast)
      )
    };
  }

  stop(): void {
    for (const socket of this.sockets) socket.close();
    this.sockets.length = 0;
    for (const timer of this.subscriptionRefreshTimers) clearInterval(timer);
    this.subscriptionRefreshTimers.length = 0;
    this.started = false;
  }

  private initializeStatus(endpointName: EndpointName, url: string, subscriptions: CryptoAttackSubscription[]): void {
    this.setStatus(createInitialStatus(endpointName, url, true, false, subscriptions));
  }

  private connectEndpoint(endpointName: EndpointName, url: string, subscriptions: CryptoAttackSubscription[]): void {
    const { config, logger } = this.input;
    let generation = 0;
    let subscribedGeneration = -1;
    let connectAttemptedGeneration = -1;

    const socket = io(url, {
      auth: { apiKey: config.cryptoAttackApiKey },
      transports: ['websocket'],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 250,
      reconnectionDelayMax: 2_000,
      timeout: 5_000
    });

    const updateStatus = (patch: Partial<ConnectionStatus>) => {
      const current = this.getEndpointStatus(endpointName, url, subscriptions);
      this.setStatus({ ...current, ...patch });
    };

    const subscribeAll = (reason: string, options: { force?: boolean; requireServerConnected?: boolean } = {}) => {
      const current = this.getEndpointStatus(endpointName, url, subscriptions);
      if (!socket.connected) return;
      if (options.requireServerConnected === true && !current.serverConnected) return;
      if (reason === 'connect') {
        if (connectAttemptedGeneration === generation) return;
        connectAttemptedGeneration = generation;
      } else if (!options.force && subscribedGeneration === generation) {
        return;
      } else {
        subscribedGeneration = generation;
      }

      const attemptedAt = new Date().toISOString();
      const nextSubscriptions = current.subscriptions.map((subscriptionStatus) => {
        const subscription = subscriptions.find((candidate) => subscriptionKey(candidate) === subscriptionStatus.key);
        if (!subscription) return subscriptionStatus;

        const payload = buildSubscribePayload(subscription);
        if (subscription.needsConfirmation) {
          logger.warn({ endpointName, payload, notes: subscription.notes }, 'Subscribing to unconfirmed CryptoAttack category');
        } else if (reason !== 'refresh') {
          logger.info({ endpointName, payload, reason }, 'CryptoAttack subscribe attempt');
        }

        socket.emit('subscribe', payload);

        return {
          ...subscriptionStatus,
          state: 'attempted' as const,
          attempts: subscriptionStatus.attempts + 1,
          lastAttemptAt: attemptedAt,
          payloadPreview: payload
        };
      });

      updateStatus({ subscriptions: nextSubscriptions });
    };

    const refreshTimer = setInterval(() => {
      subscribeAll('refresh', { force: true });
    }, config.cryptoAttackResubscribeIntervalMs);
    refreshTimer.unref?.();
    this.subscriptionRefreshTimers.push(refreshTimer);

    socket.on('connect', () => {
      generation += 1;
      subscribedGeneration = -1;
      updateStatus({
        connected: true,
        serverConnected: false,
        generation,
        socketId: socket.id ?? null,
        transport: socket.io.engine.transport.name,
        lastConnectedAt: new Date().toISOString(),
        lastError: null
      });
      subscribeAll('connect');
    });

    socket.on('connected', (data: unknown) => {
      logger.info({ endpointName, data }, 'CryptoAttack server connected event');
      updateStatus({
        connected: true,
        serverConnected: true,
        socketId: socket.id ?? null,
        transport: socket.io.engine.transport.name,
        lastConnectedAt: new Date().toISOString(),
        lastError: null
      });
      subscribeAll('connected', { requireServerConnected: true });
    });

    socket.on('news', (raw: unknown) => {
      updateStatus({ lastNewsAt: new Date().toISOString() });
      try {
        this.input.onRawEvent(raw, endpointName);
      } catch (error) {
        logger.error({ endpointName, error }, 'CryptoAttack news handler failed');
      }
    });

    socket.on('connect_error', (error: Error) => {
      logger.warn({ endpointName, error: error.message }, 'CryptoAttack connect error');
      updateStatus({ connected: false, serverConnected: false, lastError: error.message });
    });

    socket.on('disconnect', (reason: Socket.DisconnectReason) => {
      logger.warn({ endpointName, reason }, 'CryptoAttack socket disconnected');
      subscribedGeneration = -1;
      connectAttemptedGeneration = -1;
      updateStatus({
        connected: false,
        serverConnected: false,
        socketId: null,
        transport: null,
        lastDisconnectedAt: new Date().toISOString(),
        lastError: reason
      });
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      logger.info({ endpointName, attempt }, 'CryptoAttack reconnect attempt');
    });

    socket.io.on('reconnect', (attempt) => {
      logger.info({ endpointName, attempt }, 'CryptoAttack reconnected');
      subscribedGeneration = -1;
    });

    socket.io.on('reconnect_error', (error: Error) => {
      logger.warn({ endpointName, error: error.message }, 'CryptoAttack reconnect error');
      updateStatus({ lastError: error.message });
    });

    this.sockets.push(socket);
  }

  private getEndpointStatus(endpointName: EndpointName, url: string, subscriptions: CryptoAttackSubscription[]): ConnectionStatus {
    return this.statuses.get(endpointName) ?? createInitialStatus(endpointName, url, true, false, subscriptions);
  }

  private setStatus(status: ConnectionStatus): void {
    this.statuses.set(status.name as EndpointName, cloneConnectionStatus(status));
    this.input.onStatus?.(cloneConnectionStatus(status));
  }
}

function createInitialStatus(
  endpointName: EndpointName,
  url: string,
  enabled: boolean,
  mock: boolean,
  subscriptions: CryptoAttackSubscription[]
): ConnectionStatus {
  return {
    name: endpointName,
    url,
    connected: false,
    serverConnected: false,
    enabled,
    mock,
    generation: 0,
    socketId: null,
    transport: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastError: null,
    subscriptions: subscriptions.map(createSubscriptionStatus),
    subscriptionCount: subscriptions.length,
    lastNewsAt: null
  };
}

function cloneConnectionStatus(status: ConnectionStatus): ConnectionStatus {
  return {
    ...status,
    subscriptions: status.subscriptions.map((subscription) => ({
      ...subscription,
      payloadPreview: subscription.payloadPreview ? { ...subscription.payloadPreview } : null
    }))
  };
}
