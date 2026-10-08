import type { CancellationReason, InventoryStatus, OrderStatus, PaymentStatus } from '@shopstream/contracts';

/**
 * The checkout saga, as a pure state machine.
 *
 * Payment and inventory reservation run in parallel after `order.created`.
 * The order is CONFIRMED only when both succeed; if either fails the order is
 * CANCELLED and `order.cancelled` triggers compensation in the other services
 * (catalog releases stock, payments refunds a captured charge).
 *
 *   PENDING --payment ok--> PAID --stock reserved--> CONFIRMED --ship--> SHIPPED --deliver--> DELIVERED
 *   PENDING --stock reserved (flag)--> PENDING --payment ok--> CONFIRMED
 *   PENDING|PAID --payment failed | out of stock--> CANCELLED (+ compensation)
 *   PENDING|PAID|CONFIRMED --customer cancels--> CANCELLED (+ compensation)
 *
 * Events that arrive late (after cancellation) only update the sub-status;
 * compensation for them is handled by the owning service's tombstones.
 */
export interface OrderState {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  inventoryStatus: InventoryStatus;
}

export type SagaInput =
  | { type: 'payment.succeeded' }
  | { type: 'payment.failed'; code: string; message: string }
  | { type: 'payment.refunded' }
  | { type: 'inventory.reserved' }
  | { type: 'inventory.rejected'; reason: string }
  | { type: 'inventory.released' }
  | { type: 'inventory.committed' }
  | { type: 'ship' }
  | { type: 'deliver' }
  | { type: 'cancel'; reason: 'customer_request' };

export type Effect =
  | { type: 'order.confirmed' }
  | { type: 'order.cancelled'; reason: CancellationReason; detail?: string }
  | { type: 'order.shipped' }
  | { type: 'order.delivered' };

export interface TransitionResult {
  next: OrderState;
  effects: Effect[];
  /** Human readable reason recorded in the status history when the status changes. */
  reason?: string;
}

export class InvalidTransitionError extends Error {
  override readonly name = 'InvalidTransitionError';
  constructor(
    readonly from: OrderStatus,
    readonly input: SagaInput['type'],
  ) {
    super(`Cannot apply ${input} to an order in status ${from}`);
  }
}

const OPEN: ReadonlySet<OrderStatus> = new Set(['PENDING', 'PAID']);
const CANCELLABLE_BY_CUSTOMER: ReadonlySet<OrderStatus> = new Set(['PENDING', 'PAID', 'CONFIRMED']);

export function canCustomerCancel(status: OrderStatus): boolean {
  return CANCELLABLE_BY_CUSTOMER.has(status);
}

export function isTerminal(status: OrderStatus): boolean {
  return status === 'DELIVERED' || status === 'CANCELLED';
}

export function transition(state: OrderState, input: SagaInput): TransitionResult {
  const s = state;
  const same = (patch: Partial<OrderState> = {}): TransitionResult => ({
    next: { ...s, ...patch },
    effects: [],
  });

  switch (input.type) {
    case 'payment.succeeded': {
      if (s.status === 'PENDING') {
        if (s.inventoryStatus === 'RESERVED') {
          return {
            next: { ...s, status: 'CONFIRMED', paymentStatus: 'SUCCEEDED' },
            effects: [{ type: 'order.confirmed' }],
            reason: 'Payment captured and stock reserved',
          };
        }
        return {
          next: { ...s, status: 'PAID', paymentStatus: 'SUCCEEDED' },
          effects: [],
          reason: 'Payment captured',
        };
      }
      // Late success after cancellation: payments refunds it when it sees order.cancelled.
      if (s.status === 'CANCELLED' && s.paymentStatus === 'PENDING')
        return same({ paymentStatus: 'SUCCEEDED' });
      return same();
    }

    case 'payment.failed': {
      if (OPEN.has(s.status)) {
        return {
          next: { ...s, status: 'CANCELLED', paymentStatus: 'FAILED' },
          effects: [{ type: 'order.cancelled', reason: 'payment_failed', detail: input.message }],
          reason: `Payment failed: ${input.message}`,
        };
      }
      if (s.paymentStatus === 'PENDING') return same({ paymentStatus: 'FAILED' });
      return same();
    }

    case 'payment.refunded':
      return same({ paymentStatus: 'REFUNDED' });

    case 'inventory.reserved': {
      if (s.status === 'PAID') {
        return {
          next: { ...s, status: 'CONFIRMED', inventoryStatus: 'RESERVED' },
          effects: [{ type: 'order.confirmed' }],
          reason: 'Stock reserved',
        };
      }
      if (s.inventoryStatus === 'PENDING') return same({ inventoryStatus: 'RESERVED' });
      return same();
    }

    case 'inventory.rejected': {
      if (OPEN.has(s.status)) {
        return {
          next: { ...s, status: 'CANCELLED', inventoryStatus: 'REJECTED' },
          effects: [{ type: 'order.cancelled', reason: 'out_of_stock', detail: input.reason }],
          reason: 'Out of stock',
        };
      }
      if (s.inventoryStatus === 'PENDING') return same({ inventoryStatus: 'REJECTED' });
      return same();
    }

    case 'inventory.released':
      return s.inventoryStatus === 'RESERVED' || s.inventoryStatus === 'PENDING'
        ? same({ inventoryStatus: 'RELEASED' })
        : same();

    case 'inventory.committed':
      return s.inventoryStatus === 'RESERVED' ? same({ inventoryStatus: 'COMMITTED' }) : same();

    case 'ship':
      if (s.status !== 'CONFIRMED') throw new InvalidTransitionError(s.status, input.type);
      return {
        next: { ...s, status: 'SHIPPED' },
        effects: [{ type: 'order.shipped' }],
        reason: 'Handed to carrier',
      };

    case 'deliver':
      if (s.status !== 'SHIPPED') throw new InvalidTransitionError(s.status, input.type);
      return {
        next: { ...s, status: 'DELIVERED' },
        effects: [{ type: 'order.delivered' }],
        reason: 'Delivered',
      };

    case 'cancel':
      if (!CANCELLABLE_BY_CUSTOMER.has(s.status)) throw new InvalidTransitionError(s.status, input.type);
      return {
        next: { ...s, status: 'CANCELLED' },
        effects: [{ type: 'order.cancelled', reason: 'customer_request' }],
        reason: 'Cancelled by customer',
      };
  }
}
