/**
 * Pure decision logic for the inventory step of the checkout saga.
 * All-or-nothing: either every line can be reserved, or nothing is.
 */
export interface Line {
  productId: string;
  quantity: number;
}

export type ReservationPlan =
  | { kind: 'reserve'; lines: Line[] }
  | {
      kind: 'reject';
      unavailable: { productId: string; requested: number; available: number }[];
    };

/** Merges duplicate product lines, then checks each against available stock. */
export function planReservation(lines: Line[], available: ReadonlyMap<string, number>): ReservationPlan {
  const merged = new Map<string, number>();
  for (const l of lines) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.quantity);
  const unavailable: { productId: string; requested: number; available: number }[] = [];
  for (const [productId, requested] of merged) {
    const stock = available.get(productId) ?? 0;
    if (stock < requested) unavailable.push({ productId, requested, available: stock });
  }
  if (unavailable.length > 0) return { kind: 'reject', unavailable };
  return { kind: 'reserve', lines: [...merged].map(([productId, quantity]) => ({ productId, quantity })) };
}

export type CompensationAction = 'release' | 'tombstone' | 'none';

/**
 * What to do when an order is cancelled. If the cancellation overtakes the
 * order.created event (out-of-order delivery), we leave a tombstone so the late
 * order.created is ignored instead of reserving stock for a dead order.
 */
export function compensationFor(status: string | undefined): CompensationAction {
  if (status === undefined) return 'tombstone';
  if (status === 'RESERVED') return 'release';
  return 'none';
}
