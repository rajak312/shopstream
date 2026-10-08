import { describe, expect, it } from 'vitest';
import { EVENT_CATALOG } from './catalog';
import { EVENT_TYPES, EventValidationError, createEvent, parseEvent } from './events';
import { dlqSubject, eventSubject, typeFromSubject } from './subjects';

const created = () =>
  createEvent('order.created', 'orders', {
    orderId: 'o-1',
    orderNumber: 'SS-100001',
    userId: 'u-1',
    items: [{ productId: 'p-1', sku: 'S', name: 'Thing', quantity: 1, unitPriceCents: 100 }],
    subtotalCents: 100,
    shippingCents: 599,
    taxCents: 8,
    totalCents: 707,
    currency: 'USD',
    payment: { token: 'tok_succeeded_visa_4242', brand: 'visa', last4: '4242' },
  });

describe('event contracts', () => {
  it('creates a valid envelope with correlation = order id', () => {
    const e = created();
    expect(e.version).toBe(1);
    expect(e.correlationId).toBe('o-1');
    expect(parseEvent(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });

  it('refuses to create an invalid payload', () => {
    expect(() => createEvent('payment.succeeded', 'payments', { orderId: 'o' } as never)).toThrow(
      EventValidationError,
    );
  });

  it('rejects unknown types and malformed payloads when parsing', () => {
    expect(() => parseEvent({ ...created(), type: 'order.exploded' })).toThrow(EventValidationError);
    expect(() => parseEvent({ ...created(), data: { orderId: 'x' } })).toThrow(EventValidationError);
    expect(() => parseEvent('nope')).toThrow(EventValidationError);
  });

  it('keeps causation ids', () => {
    const e = createEvent('order.delivered', 'orders', { orderId: 'o', userId: 'u' }, { causationId: 'c-1' });
    expect(e.causationId).toBe('c-1');
  });

  it('documents every event type in the catalog exactly once', () => {
    const documented = EVENT_CATALOG.map((e) => e.type).sort();
    expect(documented).toEqual([...EVENT_TYPES].sort());
  });

  it('maps types to subjects and back', () => {
    expect(eventSubject('payment.failed')).toBe('shopstream.events.payment.failed');
    expect(typeFromSubject('shopstream.events.payment.failed')).toBe('payment.failed');
    expect(dlqSubject('payments', 'order.created')).toBe('shopstream.dlq.payments.order.created');
  });
});
