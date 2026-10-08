import { describe, expect, it } from 'vitest';
import { handleOnce, type IdempotencyStore } from './idempotency';

/** Minimal transactional store: writes are staged and only applied on commit. */
class MemoryStore implements IdempotencyStore<Map<string, number>> {
  processed = new Set<string>();
  balance = 0;
  async transaction<R>(work: (tx: Map<string, number>) => Promise<R>): Promise<R> {
    const tx = new Map<string, number>();
    const marks = new Set(this.processed);
    const snapshot = this.processed;
    this.processed = marks;
    try {
      const r = await work(tx);
      this.balance += tx.get('delta') ?? 0;
      return r;
    } catch (e) {
      this.processed = snapshot; // rollback the marker
      throw e;
    }
  }
  async markProcessed(_tx: Map<string, number>, consumer: string, id: string) {
    const key = `${consumer}:${id}`;
    if (this.processed.has(key)) return false;
    this.processed.add(key);
    return true;
  }
}

describe('handleOnce (idempotent consumer)', () => {
  it('applies an event once even if it is delivered many times', async () => {
    const store = new MemoryStore();
    const apply = (tx: Map<string, number>) => {
      tx.set('delta', 100);
      return Promise.resolve('applied');
    };
    expect(await handleOnce(store, 'c', 'evt-1', apply)).toEqual({ duplicate: false, result: 'applied' });
    expect(await handleOnce(store, 'c', 'evt-1', apply)).toEqual({ duplicate: true });
    expect(await handleOnce(store, 'c', 'evt-1', apply)).toEqual({ duplicate: true });
    expect(store.balance).toBe(100);
  });

  it('scopes markers per consumer', async () => {
    const store = new MemoryStore();
    await handleOnce(store, 'a', 'evt-1', async () => 1);
    expect((await handleOnce(store, 'b', 'evt-1', async () => 1)).duplicate).toBe(false);
  });

  it('rolls back the marker when the handler fails so the retry runs again', async () => {
    const store = new MemoryStore();
    await expect(
      handleOnce(store, 'c', 'evt-1', async () => {
        throw new Error('transient');
      }),
    ).rejects.toThrow('transient');
    const retry = await handleOnce(store, 'c', 'evt-1', async (tx) => {
      tx.set('delta', 5);
      return 'ok';
    });
    expect(retry).toEqual({ duplicate: false, result: 'ok' });
    expect(store.balance).toBe(5);
  });
});
