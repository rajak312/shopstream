import { createEvent, type AnyEvent } from '@shopstream/contracts';
import type { Effect } from '../domain/order-state-machine';

export interface OrderRef {
  id: string;
  userId: string;
  number: string;
  totalCents: number;
}

/** Translates state-machine effects into integration events. */
export function eventsForEffects(order: OrderRef, effects: Effect[], causationId?: string): AnyEvent[] {
  const opts = { correlationId: order.id, ...(causationId ? { causationId } : {}) };
  return effects.map((effect) => {
    switch (effect.type) {
      case 'order.confirmed':
        return createEvent(
          'order.confirmed',
          'orders',
          { orderId: order.id, userId: order.userId, totalCents: order.totalCents },
          opts,
        );
      case 'order.cancelled':
        return createEvent(
          'order.cancelled',
          'orders',
          {
            orderId: order.id,
            userId: order.userId,
            reason: effect.reason,
            ...(effect.detail ? { detail: effect.detail } : {}),
          },
          opts,
        );
      case 'order.shipped':
        return createEvent(
          'order.shipped',
          'orders',
          {
            orderId: order.id,
            userId: order.userId,
            carrier: 'ShopStream Express',
            trackingNumber: `SSX${order.number.replace(/\D/g, '')}${order.id.slice(0, 4).toUpperCase()}`,
          },
          opts,
        );
      case 'order.delivered':
        return createEvent('order.delivered', 'orders', { orderId: order.id, userId: order.userId }, opts);
    }
  });
}
