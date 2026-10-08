import {
  InvalidCardError,
  computeOrderTotals,
  lineTotalCents,
  tokenizeCard,
  type CardToken,
  type OrderTotals,
  type PricingPolicy,
} from '@shopstream/contracts';
import { z } from 'zod';

export const MAX_QUANTITY_PER_LINE = 10;

export const addressSchema = z.object({
  name: z.string().trim().min(1).max(100),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(2).max(20),
  country: z.string().trim().length(2).toUpperCase(),
});

export const checkoutInputSchema = z.object({
  cardNumber: z.string().min(12).max(23),
  cardExpiry: z.string().regex(/^(0[1-9]|1[0-2])\/(\d{2})$/, 'Expiry must be MM/YY'),
  cardCvc: z.string().regex(/^\d{3,4}$/, 'CVC must be 3 or 4 digits'),
  shippingAddress: addressSchema,
  idempotencyKey: z.string().min(8).max(100),
});

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

export class CheckoutError extends Error {
  override readonly name = 'CheckoutError';
}

export function assertNotExpired(expiry: string, now = new Date()): void {
  const [mm, yy] = expiry.split('/').map(Number) as [number, number];
  // Card is valid through the last day of its expiry month.
  const endOfMonth = Date.UTC(2000 + yy, mm, 1);
  if (endOfMonth <= now.getTime()) throw new CheckoutError('Card has expired');
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface Snapshot {
  id: string;
  sku: string;
  name: string;
  imageUrl: string;
  priceCents: number;
}

export interface PricedOrderLine {
  productId: string;
  sku: string;
  name: string;
  imageUrl: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface CheckoutPlan {
  lines: PricedOrderLine[];
  totals: OrderTotals;
  card: CardToken;
}

/** Validates the cart and the payment details and prices the order. Pure, unit tested. */
export function planCheckout(
  cart: CartLine[],
  snapshots: ReadonlyMap<string, Snapshot>,
  input: Pick<CheckoutInput, 'cardNumber' | 'cardExpiry'>,
  policy?: PricingPolicy,
  now = new Date(),
): CheckoutPlan {
  if (cart.length === 0) throw new CheckoutError('Your cart is empty');
  const lines = cart.map((item) => {
    const p = snapshots.get(item.productId);
    if (!p) throw new CheckoutError(`Product ${item.productId} is no longer available`);
    if (item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_LINE) {
      throw new CheckoutError(`Quantity for ${p.name} must be between 1 and ${MAX_QUANTITY_PER_LINE}`);
    }
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      imageUrl: p.imageUrl,
      unitPriceCents: p.priceCents,
      quantity: item.quantity,
      lineTotalCents: lineTotalCents(p.priceCents, item.quantity),
    };
  });
  assertNotExpired(input.cardExpiry, now);
  let card: CardToken;
  try {
    card = tokenizeCard(input.cardNumber);
  } catch (err) {
    if (err instanceof InvalidCardError) throw new CheckoutError(err.message);
    throw err;
  }
  return { lines, totals: computeOrderTotals(lines, policy), card };
}
