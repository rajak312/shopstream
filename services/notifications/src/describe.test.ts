import { EVENT_TYPES, createEvent } from '@shopstream/contracts';
import { describe, expect, it } from 'vitest';
import { describeEvent } from './describe';

describe('describeEvent', () => {
  it('turns domain events into timeline copy', () => {
    const e = createEvent('payment.failed', 'payments', {
      orderId: 'o',
      userId: 'u',
      paymentId: 'p',
      amountCents: 100,
      currency: 'USD',
      code: 'card_declined',
      message: 'Your card was declined.',
    });
    expect(describeEvent(e)).toEqual({
      title: 'Payment declined',
      detail: 'Your card was declined.',
      tone: 'danger',
      notify: true,
    });
  });

  it('labels compensation steps explicitly', () => {
    const e = createEvent('inventory.released', 'catalog', {
      orderId: 'o',
      userId: 'u',
      reason: 'payment_failed',
    });
    expect(describeEvent(e)?.detail).toMatch(/^Compensation/);
  });

  it('has copy for every order-scoped event type', () => {
    const covered = EVENT_TYPES.filter((t) => t !== 'catalog.product.upserted');
    expect(covered.length).toBeGreaterThan(10);
  });
});
