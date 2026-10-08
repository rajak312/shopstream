import {
  jetstream,
  jetstreamManager,
  JetStreamApiError,
  RetentionPolicy,
  StorageType,
  DiscardPolicy,
  type JetStreamClient,
  type JetStreamManager,
  type StreamConfig,
} from '@nats-io/jetstream';
import { connect, nanos, type NatsConnection } from '@nats-io/transport-node';
import { DLQ_STREAM, DLQ_SUBJECT_PREFIX, EVENT_SUBJECT_PREFIX, EVENTS_STREAM } from '@shopstream/contracts';
import type { Logger } from '../logger';

export interface NatsHandles {
  nc: NatsConnection;
  js: JetStreamClient;
  jsm: JetStreamManager;
}

export interface ConnectOptions {
  url: string;
  name: string;
  logger: Logger;
  /** How long to keep retrying the initial connection (the broker may start after us). */
  connectTimeoutMs?: number;
}

export async function connectNats({
  url,
  name,
  logger,
  connectTimeoutMs = 60_000,
}: ConnectOptions): Promise<NatsHandles> {
  const deadline = Date.now() + connectTimeoutMs;
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const nc = await connect({
        servers: url.split(','),
        name,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 1_000,
      });
      logger.info({ server: nc.getServer() }, 'connected to NATS');
      void (async () => {
        for await (const s of nc.status()) {
          if (s.type === 'disconnect' || s.type === 'reconnect' || s.type === 'error') {
            logger.warn({ status: s.type }, 'NATS connection status changed');
          }
        }
      })();
      const jsm = await jetstreamManager(nc);
      return { nc, js: jetstream(nc), jsm };
    } catch (err) {
      if (Date.now() > deadline) throw err;
      logger.warn({ attempt, err: (err as Error).message }, 'NATS not reachable yet, retrying');
      await new Promise((r) => setTimeout(r, Math.min(500 * attempt, 3_000)));
    }
  }
}

export interface StreamOptions {
  storage: 'file' | 'memory';
  replicas: number;
  maxMb?: number;
}

/** Idempotently creates (or updates) the event stream and the dead-letter stream. */
export async function ensureStreams(jsm: JetStreamManager, opts: StreamOptions): Promise<void> {
  const storage = opts.storage === 'memory' ? StorageType.Memory : StorageType.File;
  const streams: (Partial<StreamConfig> & { name: string })[] = [
    {
      name: EVENTS_STREAM,
      subjects: [`${EVENT_SUBJECT_PREFIX}.>`],
      retention: RetentionPolicy.Limits,
      storage,
      num_replicas: opts.replicas,
      max_age: nanos(7 * 24 * 60 * 60 * 1000),
      max_bytes: (opts.maxMb ?? 256) * 1024 * 1024,
      discard: DiscardPolicy.Old,
      // Publishes carry Nats-Msg-Id = event id, so a relay retry inside this window is dropped by the broker.
      duplicate_window: nanos(2 * 60 * 1000),
    },
    {
      name: DLQ_STREAM,
      subjects: [`${DLQ_SUBJECT_PREFIX}.>`],
      retention: RetentionPolicy.Limits,
      storage,
      num_replicas: opts.replicas,
      max_age: nanos(30 * 24 * 60 * 60 * 1000),
      max_bytes: Math.max(8, Math.floor((opts.maxMb ?? 256) / 4)) * 1024 * 1024,
      discard: DiscardPolicy.Old,
    },
  ];
  for (const cfg of streams) {
    try {
      await jsm.streams.info(cfg.name);
      await jsm.streams.update(cfg.name, cfg);
    } catch (err) {
      if (err instanceof JetStreamApiError && err.status === 404) {
        try {
          await jsm.streams.add(cfg);
        } catch (addErr) {
          // Another service may have created it concurrently.
          if (!(addErr instanceof JetStreamApiError && /already in use/i.test(addErr.message))) {
            throw addErr;
          }
        }
      } else {
        throw err;
      }
    }
  }
}
