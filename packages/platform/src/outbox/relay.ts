import { context, propagation } from '@opentelemetry/api';
import type { AnyEvent } from '@shopstream/contracts';
import type { Logger } from '../logger';
import type { ServiceMetrics } from '../metrics';
import type { EventPublisher } from '../messaging/publisher';

/**
 * A row in a service's outbox table/collection. It is written in the *same*
 * database transaction as the business change, so an event exists if and only
 * if the state change committed. The relay publishes it afterwards.
 */
export interface OutboxRecord {
  id: string;
  event: AnyEvent;
  /** W3C trace context captured when the row was written. */
  headers: Record<string, string>;
  attempts: number;
}

export interface OutboxStore {
  /** Returns up to `limit` unpublished records, oldest first, claimed for this relay instance. */
  claimBatch(limit: number): Promise<OutboxRecord[]>;
  markPublished(ids: string[]): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  countPending(): Promise<number>;
}

export interface OutboxRelayOptions {
  batchSize?: number;
  pollIntervalMs?: number;
  /** Max backoff after consecutive broker failures. */
  maxBackoffMs?: number;
}

/**
 * Polls the outbox and publishes in commit order. Publishing stops at the first
 * failure so per-aggregate ordering is preserved; delivery is at-least-once and
 * consumers are idempotent (plus JetStream de-duplicates on the event id).
 */
export class OutboxRelay {
  private running = false;
  private loopPromise?: Promise<void>;
  private wake?: () => void;
  /** Set when trigger() fires mid-drain, so the nudge is not lost. */
  private triggered = false;
  private failures = 0;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly maxBackoffMs: number;

  constructor(
    private readonly store: OutboxStore,
    private readonly publisher: EventPublisher,
    private readonly logger: Logger,
    options: OutboxRelayOptions = {},
    private readonly metrics?: ServiceMetrics,
  ) {
    this.batchSize = options.batchSize ?? 50;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 10_000;
  }

  /** Publishes one batch. Returns how many records were published. */
  async drainOnce(): Promise<number> {
    const batch = await this.store.claimBatch(this.batchSize);
    const published: string[] = [];
    try {
      for (const record of batch) {
        try {
          // Publish inside the producer's trace so the JetStream hop joins the original request trace.
          const parent = propagation.extract(context.active(), record.headers);
          await context.with(parent, () => this.publisher.publish(record.event, record.headers));
          published.push(record.id);
        } catch (err) {
          await this.store.markFailed(record.id, (err as Error).message ?? String(err));
          throw err;
        }
      }
    } finally {
      if (published.length > 0) await this.store.markPublished(published);
    }
    return published.length;
  }

  /** Nudges the relay right after a commit so events go out with minimal latency. */
  trigger(): void {
    this.triggered = true;
    this.wake?.();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let delay = this.pollIntervalMs;
      this.triggered = false;
      try {
        const n = await this.drainOnce();
        this.failures = 0;
        if (n === this.batchSize) continue; // more waiting, keep draining
        if (this.metrics) this.metrics.outboxPending.set(await this.store.countPending());
      } catch (err) {
        this.failures++;
        delay = Math.min(this.pollIntervalMs * 2 ** this.failures, this.maxBackoffMs);
        this.logger.warn({ err, failures: this.failures, delay }, 'outbox relay publish failed');
      }
      if (this.triggered && this.failures === 0) continue;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wake = undefined;
    }
  }
}
