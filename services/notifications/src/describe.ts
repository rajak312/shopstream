import { formatMoney, type AnyEvent } from '@shopstream/contracts';

export type Tone = 'info' | 'success' | 'warning' | 'danger';

export interface Description {
  title: string;
  detail: string;
  tone: Tone;
  /** Also surface in the user's notification feed (not just the order timeline). */
  notify: boolean;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Human-readable timeline entry for each domain event. */
export function describeEvent(event: AnyEvent): Description | undefined {
  switch (event.type) {
    case 'order.created':
      return {
        title: 'Order placed',
        detail: `${event.data.orderNumber} · ${formatMoney(event.data.totalCents)} · ${cap(event.data.payment.brand)} •••• ${event.data.payment.last4}`,
        tone: 'info',
        notify: false,
      };
    case 'payment.succeeded':
      return {
        title: 'Payment authorized',
        detail: `${formatMoney(event.data.amountCents)} charged to ${cap(event.data.brand)} •••• ${event.data.last4}`,
        tone: 'success',
        notify: false,
      };
    case 'payment.failed':
      return { title: 'Payment declined', detail: event.data.message, tone: 'danger', notify: true };
    case 'inventory.reserved':
      return {
        title: 'Stock reserved',
        detail: `${event.data.items.reduce((n, i) => n + i.quantity, 0)} item(s) held in the warehouse`,
        tone: 'success',
        notify: false,
      };
    case 'inventory.rejected':
      return {
        title: 'Out of stock',
        detail: `${event.data.unavailable.length} item(s) could not be reserved`,
        tone: 'danger',
        notify: true,
      };
    case 'order.confirmed':
      return {
        title: 'Order confirmed',
        detail: 'Payment captured and stock reserved — preparing your parcel',
        tone: 'success',
        notify: true,
      };
    case 'order.cancelled':
      return {
        title: 'Order cancelled',
        detail:
          event.data.reason === 'customer_request'
            ? 'Cancelled at your request'
            : (event.data.detail ?? event.data.reason.replace('_', ' ')),
        tone: 'danger',
        notify: true,
      };
    case 'inventory.released':
      return {
        title: 'Stock released',
        detail: 'Compensation: reserved items returned to the shelf',
        tone: 'warning',
        notify: false,
      };
    case 'payment.refunded':
      return {
        title: 'Payment refunded',
        detail: `Compensation: ${formatMoney(event.data.amountCents)} returned to your card`,
        tone: 'warning',
        notify: true,
      };
    case 'order.shipped':
      return {
        title: 'Shipped',
        detail: `${event.data.carrier} · tracking ${event.data.trackingNumber}`,
        tone: 'info',
        notify: true,
      };
    case 'inventory.committed':
      return {
        title: 'Inventory committed',
        detail: 'Reserved stock permanently deducted',
        tone: 'info',
        notify: false,
      };
    case 'order.delivered':
      return { title: 'Delivered', detail: 'Your parcel has arrived. Enjoy!', tone: 'success', notify: true };
    default:
      return undefined;
  }
}
