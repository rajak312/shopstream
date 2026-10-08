/**
 * Idempotent-consumer helper. JetStream gives at-least-once delivery, so every
 * handler records `(consumer, eventId)` in its own database *inside the same
 * transaction* as its side effects. A redelivered event finds the marker and is
 * acknowledged without being applied twice; a failed handler rolls the marker
 * back, so the retry runs again from scratch.
 */
export interface IdempotencyStore<Tx> {
  /** Runs `work` in a database transaction. */
  transaction<R>(work: (tx: Tx) => Promise<R>): Promise<R>;
  /** Inserts the processed marker; returns false if it already existed. */
  markProcessed(tx: Tx, consumer: string, eventId: string): Promise<boolean>;
}

export type IdempotentResult<T> = { duplicate: true } | { duplicate: false; result: T };

export async function handleOnce<Tx, T>(
  store: IdempotencyStore<Tx>,
  consumer: string,
  eventId: string,
  handle: (tx: Tx) => Promise<T>,
): Promise<IdempotentResult<T>> {
  return store.transaction(async (tx) => {
    const fresh = await store.markProcessed(tx, consumer, eventId);
    if (!fresh) return { duplicate: true } as const;
    const result = await handle(tx);
    return { duplicate: false, result } as const;
  });
}
