import { createEvent, type AnyEvent } from '@shopstream/contracts';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { EventPublisher } from '../messaging/publisher';
import { OutboxRelay, type OutboxRecord, type OutboxStore } from './relay';

const logger = pino({ level: 'silent' });

function event(n: number): AnyEvent {
  return createEvent('order.delivered', 'orders', { orderId: `o-${n}`, userId: 'u' });
}

class MemoryOutbox implements OutboxStore {
  rows: (OutboxRecord & { published: boolean; error?: string })[] = [];
  add(e: AnyEvent) {
    this.rows.push({
      id: e.id,
      event: e,
      headers: { traceparent: '00-abc-def-01' },
      attempts: 0,
      published: false,
    });
  }
  async claimBatch(limit: number) {
    return this.rows.filter((r) => !r.published).slice(0, limit);
  }
  async markPublished(ids: string[]) {
    for (const r of this.rows) if (ids.includes(r.id)) r.published = true;
  }
  async markFailed(id: string, error: string) {
    const r = this.rows.find((x) => x.id === id)!;
    r.attempts++;
    r.error = error;
  }
  async countPending() {
    return this.rows.filter((r) => !r.published).length;
  }
}

class FakePublisher implements EventPublisher {
  sent: AnyEvent[] = [];
  failOn = new Set<string>();
  async publish(e: AnyEvent) {
    if (this.failOn.has(e.id)) throw new Error('broker unavailable');
    this.sent.push(e);
  }
}

describe('OutboxRelay', () => {
  it('publishes pending records in commit order and marks them published', async () => {
    const store = new MemoryOutbox();
    const pub = new FakePublisher();
    const events = [1, 2, 3].map(event);
    events.forEach((e) => store.add(e));
    const relay = new OutboxRelay(store, pub, logger, { batchSize: 10 });

    expect(await relay.drainOnce()).toBe(3);
    expect(pub.sent.map((e) => e.id)).toEqual(events.map((e) => e.id));
    expect(await store.countPending()).toBe(0);
    expect(await relay.drainOnce()).toBe(0);
  });

  it('stops at the first failure to preserve ordering, then resumes (at-least-once)', async () => {
    const store = new MemoryOutbox();
    const pub = new FakePublisher();
    const events = [1, 2, 3].map(event);
    events.forEach((e) => store.add(e));
    pub.failOn.add(events[1]!.id);
    const relay = new OutboxRelay(store, pub, logger);

    await expect(relay.drainOnce()).rejects.toThrow('broker unavailable');
    expect(pub.sent.map((e) => e.id)).toEqual([events[0]!.id]); // #3 not sent before #2
    expect(store.rows[0]!.published).toBe(true);
    expect(store.rows[1]!.error).toBe('broker unavailable');

    pub.failOn.clear();
    expect(await relay.drainOnce()).toBe(2);
    expect(pub.sent.map((e) => e.id)).toEqual(events.map((e) => e.id));
  });

  it('respects the batch size', async () => {
    const store = new MemoryOutbox();
    const pub = new FakePublisher();
    for (let i = 0; i < 5; i++) store.add(event(i));
    const relay = new OutboxRelay(store, pub, logger, { batchSize: 2 });
    expect(await relay.drainOnce()).toBe(2);
    expect(await store.countPending()).toBe(3);
  });

  it('runs in the background, wakes up on trigger() and stops cleanly', async () => {
    const store = new MemoryOutbox();
    const pub = new FakePublisher();
    const relay = new OutboxRelay(store, pub, logger, { pollIntervalMs: 60_000 });
    relay.start();
    store.add(event(1));
    relay.trigger();
    await new Promise((r) => setTimeout(r, 20));
    expect(pub.sent).toHaveLength(1);
    await relay.stop();
  });
});
