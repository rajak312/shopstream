import type { EventType, ServiceName } from './events';

/** Who produces and who consumes every event. Drives docs and the live event-flow visualizer. */
export interface EventCatalogEntry {
  type: EventType;
  producer: ServiceName;
  consumers: ServiceName[];
  description: string;
}

export const EVENT_CATALOG: readonly EventCatalogEntry[] = [
  {
    type: 'catalog.product.upserted',
    producer: 'catalog',
    consumers: ['orders'],
    description:
      'Event-carried state transfer: orders keeps a local price/name replica so checkout never calls catalog synchronously.',
  },
  {
    type: 'order.created',
    producer: 'orders',
    consumers: ['catalog', 'payments', 'notifications'],
    description: 'Checkout committed. Starts the saga: reserve stock and charge the card in parallel.',
  },
  {
    type: 'inventory.reserved',
    producer: 'catalog',
    consumers: ['orders', 'notifications'],
    description: 'All lines were reserved atomically (MongoDB transaction).',
  },
  {
    type: 'inventory.rejected',
    producer: 'catalog',
    consumers: ['orders', 'notifications'],
    description: 'At least one line is out of stock; nothing was reserved.',
  },
  {
    type: 'payment.succeeded',
    producer: 'payments',
    consumers: ['orders', 'notifications'],
    description: 'The simulated processor authorized the card.',
  },
  {
    type: 'payment.failed',
    producer: 'payments',
    consumers: ['orders', 'notifications'],
    description: 'Card declined. Orders cancels the order, which triggers compensation.',
  },
  {
    type: 'order.confirmed',
    producer: 'orders',
    consumers: ['notifications'],
    description: 'Payment captured and stock reserved: the order will be fulfilled.',
  },
  {
    type: 'order.cancelled',
    producer: 'orders',
    consumers: ['catalog', 'payments', 'notifications'],
    description: 'Compensation trigger: catalog releases reserved stock, payments refunds a captured charge.',
  },
  {
    type: 'inventory.released',
    producer: 'catalog',
    consumers: ['orders', 'notifications'],
    description: 'Compensation done: reserved stock returned to the shelf.',
  },
  {
    type: 'payment.refunded',
    producer: 'payments',
    consumers: ['orders', 'notifications'],
    description: 'Compensation done: a captured payment was refunded.',
  },
  {
    type: 'order.shipped',
    producer: 'orders',
    consumers: ['catalog', 'notifications'],
    description: 'The simulated warehouse shipped the order; catalog commits the reservation.',
  },
  {
    type: 'inventory.committed',
    producer: 'catalog',
    consumers: ['notifications'],
    description: 'Reserved stock permanently deducted.',
  },
  {
    type: 'order.delivered',
    producer: 'orders',
    consumers: ['notifications'],
    description: 'The parcel arrived. Terminal happy-path state.',
  },
];

export function consumersOf(type: EventType): ServiceName[] {
  return EVENT_CATALOG.find((e) => e.type === type)?.consumers ?? [];
}
