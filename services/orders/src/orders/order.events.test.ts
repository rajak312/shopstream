import { parseEvent } from '@shopstream/contracts';
import { describe, expect, it } from 'vitest';
import { eventsForEffects } from './order.events';

describe('eventsForEffects', () => {
  const order = {
    id: '6b7f3f9e-0000-4000-8000-000000000001',
    userId: 'u-1',
    number: 'SS-100042',
    totalCents: 1000,
  };

  it('turns state machine effects into valid, correlated integration events', () => {
    const events = eventsForEffects(
      order,
      [{ type: 'order.cancelled', reason: 'payment_failed', detail: 'Declined' }, { type: 'order.shipped' }],
      'cause-1',
    );
    expect(events.map((e) => e.type)).toEqual(['order.cancelled', 'order.shipped']);
    for (const e of events) {
      expect(parseEvent(e)).toEqual(e);
      expect(e.correlationId).toBe(order.id);
      expect(e.causationId).toBe('cause-1');
    }
    const shipped = events[1]!;
    expect(shipped.type === 'order.shipped' && shipped.data.trackingNumber).toMatch(/^SSX100042/);
  });
});
