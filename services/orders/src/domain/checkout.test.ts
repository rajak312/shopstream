import { describe, expect, it } from 'vitest';
import { CheckoutError, assertNotExpired, planCheckout, type Snapshot } from './checkout';

const snapshots = new Map<string, Snapshot>([
  ['p1', { id: 'p1', sku: 'A', name: 'Lamp', imageUrl: '/a.svg', priceCents: 1999 }],
  ['p2', { id: 'p2', sku: 'B', name: 'Mug', imageUrl: '/b.svg', priceCents: 3500 }],
]);
const card = { cardNumber: '4242 4242 4242 4242', cardExpiry: '12/40' };

describe('planCheckout', () => {
  it('prices lines from the local product replica and tokenizes the card', () => {
    const plan = planCheckout(
      [
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 1 },
      ],
      snapshots,
      card,
    );
    expect(plan.lines.map((l) => l.lineTotalCents)).toEqual([3998, 3500]);
    expect(plan.totals).toEqual({ subtotalCents: 7498, shippingCents: 0, taxCents: 619, totalCents: 8117 });
    expect(plan.card).toEqual({ token: 'tok_succeeded_visa_4242', brand: 'visa', last4: '4242' });
  });

  it('rejects an empty cart, unknown products and bad quantities', () => {
    expect(() => planCheckout([], snapshots, card)).toThrow('empty');
    expect(() => planCheckout([{ productId: 'nope', quantity: 1 }], snapshots, card)).toThrow(CheckoutError);
    expect(() => planCheckout([{ productId: 'p1', quantity: 11 }], snapshots, card)).toThrow(
      /between 1 and 10/,
    );
  });

  it('rejects invalid and expired cards', () => {
    expect(() =>
      planCheckout([{ productId: 'p1', quantity: 1 }], snapshots, {
        ...card,
        cardNumber: '4242 4242 4242 4241',
      }),
    ).toThrow('Card number is invalid');
    expect(() => assertNotExpired('01/20', new Date('2026-01-01'))).toThrow('expired');
    expect(() => assertNotExpired('01/26', new Date('2026-01-31T23:00:00Z'))).not.toThrow();
    expect(() => assertNotExpired('01/26', new Date('2026-02-01T00:00:00Z'))).toThrow('expired');
  });
});
