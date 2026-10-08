import { randomUUID } from 'node:crypto';
import type { AnyEvent } from '@shopstream/contracts';
import {
  currentTraceHeaders,
  type IdempotencyStore,
  type OutboxRecord,
  type OutboxStore,
} from '@shopstream/platform';
import type { Prisma, PrismaClient, Tx } from './prisma';

interface ClaimedRow {
  id: string;
  payload: AnyEvent;
  headers: Record<string, string>;
  attempts: number;
}

/** Postgres-backed transactional outbox + idempotent-consumer markers. */
export class PrismaEventStore implements OutboxStore, IdempotencyStore<Tx> {
  private readonly instanceId = randomUUID();

  constructor(private readonly prisma: PrismaClient) {}

  transaction<R>(work: (tx: Tx) => Promise<R>): Promise<R> {
    return this.prisma.$transaction(work, { timeout: 15_000, maxWait: 10_000 });
  }

  /** Called inside the business transaction: the event commits atomically with the state change. */
  async enqueue(tx: Tx, events: AnyEvent[]): Promise<void> {
    if (events.length === 0) return;
    const headers = currentTraceHeaders();
    // createMany keeps the given order, and `seq` (bigserial) preserves it for the relay.
    await tx.outboxEvent.createMany({
      data: events.map((e) => ({
        id: e.id,
        aggregateId: e.correlationId,
        type: e.type,
        payload: e as unknown as Prisma.InputJsonValue,
        headers,
      })),
    });
  }

  async markProcessed(tx: Tx, consumer: string, eventId: string): Promise<boolean> {
    // ON CONFLICT DO NOTHING: unlike a failing INSERT it does not abort the transaction.
    const res = await tx.processedEvent.createMany({ data: [{ consumer, eventId }], skipDuplicates: true });
    return res.count === 1;
  }

  /**
   * Leases a batch with FOR UPDATE SKIP LOCKED so several replicas can run the
   * relay concurrently without publishing the same rows at the same time.
   */
  async claimBatch(limit: number): Promise<OutboxRecord[]> {
    const token = `${this.instanceId}:${Date.now()}`;
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE outbox_events SET locked_until = now() + interval '30 seconds', locked_by = ${token}
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE published_at IS NULL AND (locked_until IS NULL OR locked_until < now())
        ORDER BY seq
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id::text, payload, headers, attempts, seq`;
    return rows
      .sort((a, b) => Number((a as unknown as { seq: bigint }).seq - (b as unknown as { seq: bigint }).seq))
      .map((r) => ({ id: r.id, event: r.payload, headers: r.headers ?? {}, attempts: r.attempts }));
  }

  async markPublished(ids: string[]): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: { id: { in: ids } },
      data: { publishedAt: new Date(), lockedUntil: null, lockedBy: null, attempts: { increment: 1 } },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        lastError: error.slice(0, 1000),
        lockedUntil: null,
        lockedBy: null,
        attempts: { increment: 1 },
      },
    });
  }

  countPending(): Promise<number> {
    return this.prisma.outboxEvent.count({ where: { publishedAt: null } });
  }

  /** Housekeeping: published rows older than the retention window are deleted. */
  async purgePublished(olderThanMs = 7 * 24 * 3600 * 1000): Promise<number> {
    const res = await this.prisma.outboxEvent.deleteMany({
      where: { publishedAt: { lt: new Date(Date.now() - olderThanMs) } },
    });
    return res.count;
  }
}
