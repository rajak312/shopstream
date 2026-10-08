import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  canCustomerCancel,
  transition,
  type OrderState,
  type SagaInput,
} from './order-state-machine';

const pending: OrderState = { status: 'PENDING', paymentStatus: 'PENDING', inventoryStatus: 'PENDING' };

/** Replays a sequence of saga inputs and collects every emitted effect. */
function run(inputs: SagaInput[], from: OrderState = pending) {
  let state = from;
  const effects: string[] = [];
  for (const input of inputs) {
    const r = transition(state, input);
    state = r.next;
    effects.push(...r.effects.map((e) => (e.type === 'order.cancelled' ? `${e.type}:${e.reason}` : e.type)));
  }
  return { state, effects };
}

describe('order state machine — happy paths', () => {
  it('payment first, then stock -> PAID -> CONFIRMED', () => {
    const r1 = transition(pending, { type: 'payment.succeeded' });
    expect(r1.next).toEqual({ status: 'PAID', paymentStatus: 'SUCCEEDED', inventoryStatus: 'PENDING' });
    expect(r1.effects).toEqual([]);
    const r2 = transition(r1.next, { type: 'inventory.reserved' });
    expect(r2.next.status).toBe('CONFIRMED');
    expect(r2.effects).toEqual([{ type: 'order.confirmed' }]);
  });

  it('stock first, then payment -> CONFIRMED directly', () => {
    const { state, effects } = run([{ type: 'inventory.reserved' }, { type: 'payment.succeeded' }]);
    expect(state).toEqual({ status: 'CONFIRMED', paymentStatus: 'SUCCEEDED', inventoryStatus: 'RESERVED' });
    expect(effects).toEqual(['order.confirmed']);
  });

  it('ships and delivers a confirmed order', () => {
    const { state, effects } = run([
      { type: 'payment.succeeded' },
      { type: 'inventory.reserved' },
      { type: 'ship' },
      { type: 'inventory.committed' },
      { type: 'deliver' },
    ]);
    expect(state).toEqual({ status: 'DELIVERED', paymentStatus: 'SUCCEEDED', inventoryStatus: 'COMMITTED' });
    expect(effects).toEqual(['order.confirmed', 'order.shipped', 'order.delivered']);
  });
});

describe('order state machine — saga compensation', () => {
  it('payment failure cancels the order and emits compensation', () => {
    const r = transition(pending, { type: 'payment.failed', code: 'card_declined', message: 'Declined' });
    expect(r.next).toEqual({ status: 'CANCELLED', paymentStatus: 'FAILED', inventoryStatus: 'PENDING' });
    expect(r.effects).toEqual([{ type: 'order.cancelled', reason: 'payment_failed', detail: 'Declined' }]);
  });

  it('payment failure after stock was reserved -> cancel, then stock is released', () => {
    const { state, effects } = run([
      { type: 'inventory.reserved' },
      { type: 'payment.failed', code: 'card_declined', message: 'Declined' },
      { type: 'inventory.released' },
    ]);
    expect(state).toEqual({ status: 'CANCELLED', paymentStatus: 'FAILED', inventoryStatus: 'RELEASED' });
    expect(effects).toEqual(['order.cancelled:payment_failed']);
  });

  it('out of stock after payment -> cancel, then the payment is refunded', () => {
    const { state, effects } = run([
      { type: 'payment.succeeded' },
      { type: 'inventory.rejected', reason: 'insufficient_stock' },
      { type: 'payment.refunded' },
    ]);
    expect(state).toEqual({ status: 'CANCELLED', paymentStatus: 'REFUNDED', inventoryStatus: 'REJECTED' });
    expect(effects).toEqual(['order.cancelled:out_of_stock']);
  });

  it('a late payment success after cancellation never resurrects the order', () => {
    const { state, effects } = run([
      { type: 'inventory.rejected', reason: 'insufficient_stock' },
      { type: 'payment.succeeded' },
    ]);
    expect(state.status).toBe('CANCELLED');
    expect(state.paymentStatus).toBe('SUCCEEDED'); // payments refunds it on order.cancelled
    expect(effects).toEqual(['order.cancelled:out_of_stock']);
  });

  it('a late stock reservation after cancellation does not confirm', () => {
    const { state, effects } = run([
      { type: 'payment.failed', code: 'card_declined', message: 'x' },
      { type: 'inventory.reserved' },
    ]);
    expect(state.status).toBe('CANCELLED');
    expect(effects).toEqual(['order.cancelled:payment_failed']);
  });

  it('emits exactly one cancellation even if both steps fail', () => {
    const { effects } = run([
      { type: 'payment.failed', code: 'card_declined', message: 'x' },
      { type: 'inventory.rejected', reason: 'insufficient_stock' },
    ]);
    expect(effects).toEqual(['order.cancelled:payment_failed']);
  });

  it('customer cancellation of a confirmed order compensates both steps', () => {
    const confirmed: OrderState = {
      status: 'CONFIRMED',
      paymentStatus: 'SUCCEEDED',
      inventoryStatus: 'RESERVED',
    };
    const r = transition(confirmed, { type: 'cancel', reason: 'customer_request' });
    expect(r.next.status).toBe('CANCELLED');
    expect(r.effects).toEqual([{ type: 'order.cancelled', reason: 'customer_request' }]);
  });
});

describe('order state machine — guards and idempotence', () => {
  it.each<[OrderState['status'], SagaInput['type']]>([
    ['PENDING', 'ship'],
    ['PAID', 'ship'],
    ['CONFIRMED', 'deliver'],
    ['SHIPPED', 'cancel'],
    ['DELIVERED', 'cancel'],
    ['CANCELLED', 'cancel'],
  ])('rejects %s + %s', (status, type) => {
    const input = (type === 'cancel' ? { type, reason: 'customer_request' } : { type }) as SagaInput;
    expect(() => transition({ ...pending, status }, input)).toThrow(InvalidTransitionError);
  });

  it('re-applying the same event is a no-op', () => {
    const once = transition(pending, { type: 'payment.succeeded' });
    const twice = transition(once.next, { type: 'payment.succeeded' });
    expect(twice.next).toEqual(once.next);
    expect(twice.effects).toEqual([]);
  });

  it('knows which statuses the customer may cancel', () => {
    expect(canCustomerCancel('PENDING')).toBe(true);
    expect(canCustomerCancel('CONFIRMED')).toBe(true);
    expect(canCustomerCancel('SHIPPED')).toBe(false);
  });
});
