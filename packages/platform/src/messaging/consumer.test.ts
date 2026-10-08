import { createEvent, EventValidationError, type AnyEvent } from '@shopstream/contracts';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RETRY_POLICY,
  NonRetryableError,
  decideOnFailure,
  processDelivery,
  type DeadLetterSink,
  type Delivery,
  type HandlerResult,
} from './consumer';

const logger = pino({ level: 'silent' });
const policy = { maxDeliver: 3, backoffMs: [100, 500] };

function delivery(
  payload: unknown,
  attempt = 1,
): Delivery & { acked: boolean; naked?: number; termed: boolean } {
  const d = {
    subject: 'shopstream.events.payment.succeeded',
    data: new TextEncoder().encode(JSON.stringify(payload)),
    attempt,
    acked: false,
    termed: false,
    naked: undefined as number | undefined,
    ack: () => {
      d.acked = true;
    },
    nak: (ms?: number) => {
      d.naked = ms;
    },
    term: () => {
      d.termed = true;
    },
  };
  return d;
}

const evt = (): AnyEvent =>
  createEvent('payment.succeeded', 'payments', {
    orderId: 'o',
    userId: 'u',
    paymentId: 'p',
    amountCents: 100,
    currency: 'USD',
    brand: 'visa',
    last4: '4242',
  });

function deps(handler: (e: AnyEvent) => Promise<HandlerResult>) {
  const dlq: DeadLetterSink & { calls: string[] } = {
    calls: [],
    async deadLetter(_d, _c, reason) {
      this.calls.push(reason);
    },
  };
  const flow = { report: vi.fn() };
  return {
    dlq,
    flow,
    deps: {
      service: 'orders' as const,
      durable: 'orders-saga',
      handler,
      policy,
      logger,
      deadLetters: dlq,
      flow: flow as never,
    },
  };
}

describe('decideOnFailure', () => {
  it('retries with the configured backoff until max deliveries', () => {
    expect(decideOnFailure(new Error('x'), 1, policy)).toEqual({ kind: 'retry', delayMs: 100 });
    expect(decideOnFailure(new Error('x'), 2, policy)).toEqual({ kind: 'retry', delayMs: 500 });
    expect(decideOnFailure(new Error('x'), 3, policy).kind).toBe('dead_letter');
  });

  it('reuses the last backoff step', () => {
    expect(decideOnFailure(new Error('x'), 4, { maxDeliver: 10, backoffMs: [1, 2] })).toEqual({
      kind: 'retry',
      delayMs: 2,
    });
  });

  it('dead-letters poison messages and non-retryable errors immediately', () => {
    expect(decideOnFailure(new EventValidationError('bad', []), 1, policy).kind).toBe('dead_letter');
    expect(decideOnFailure(new NonRetryableError('nope'), 1, policy).kind).toBe('dead_letter');
  });

  it('has a sane default policy', () => {
    expect(DEFAULT_RETRY_POLICY.maxDeliver).toBeGreaterThan(DEFAULT_RETRY_POLICY.backoffMs.length);
  });
});

describe('processDelivery', () => {
  it('acks after a successful handler and reports the flow', async () => {
    const e = evt();
    const handler = vi.fn(async () => 'processed' as const);
    const { deps: d, flow } = deps(handler);
    const msg = delivery(e);
    await processDelivery(msg, d);
    expect(handler).toHaveBeenCalledWith(e, { attempt: 1, subject: msg.subject });
    expect(msg.acked).toBe(true);
    expect(flow.report).toHaveBeenCalledWith(expect.objectContaining({ action: 'consumed', eventId: e.id }));
  });

  it('acks duplicates (idempotent consumer) and reports them', async () => {
    const { deps: d, flow } = deps(async () => 'duplicate');
    const msg = delivery(evt());
    await processDelivery(msg, d);
    expect(msg.acked).toBe(true);
    expect(flow.report).toHaveBeenCalledWith(expect.objectContaining({ action: 'duplicate' }));
  });

  it('naks with backoff when the handler throws', async () => {
    const { deps: d, dlq } = deps(async () => {
      throw new Error('db down');
    });
    const msg = delivery(evt(), 2);
    await processDelivery(msg, d);
    expect(msg.acked).toBe(false);
    expect(msg.naked).toBe(500);
    expect(dlq.calls).toHaveLength(0);
  });

  it('dead-letters and terminates after the last attempt', async () => {
    const {
      deps: d,
      dlq,
      flow,
    } = deps(async () => {
      throw new Error('still down');
    });
    const msg = delivery(evt(), 3);
    await processDelivery(msg, d);
    expect(msg.termed).toBe(true);
    expect(dlq.calls[0]).toMatch(/max deliveries/);
    expect(flow.report).toHaveBeenCalledWith(expect.objectContaining({ action: 'dead_lettered' }));
  });

  it('dead-letters poison messages without calling the handler', async () => {
    const handler = vi.fn(async () => 'processed' as const);
    const { deps: d, dlq } = deps(handler);
    const msg = delivery({ hello: 'world' });
    await processDelivery(msg, d);
    expect(handler).not.toHaveBeenCalled();
    expect(msg.termed).toBe(true);
    expect(dlq.calls[0]).toMatch(/poison/);
  });

  it('naks (does not lose the message) if the DLQ publish itself fails', async () => {
    const { deps: d } = deps(async () => {
      throw new Error('boom');
    });
    d.deadLetters = { deadLetter: async () => Promise.reject(new Error('dlq down')) } as never;
    const msg = delivery(evt(), 3);
    await processDelivery(msg, d);
    expect(msg.termed).toBe(false);
    expect(msg.naked).toBeGreaterThan(0);
  });
});
