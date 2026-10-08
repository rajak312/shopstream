/**
 * Money is always represented as an integer number of minor units (cents).
 * Floating point never touches an amount: every operation validates its inputs
 * and rounds explicitly (half away from zero) when a fraction is unavoidable.
 */
export const CURRENCIES = ['USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Money {
  readonly amountCents: number;
  readonly currency: Currency;
}

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

export function assertCents(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer number of cents, got ${value}`);
  }
  return value;
}

export function money(amountCents: number, currency: Currency = 'USD'): Money {
  return { amountCents: assertCents(amountCents), currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return money(a.amountCents + b.amountCents, a.currency);
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((acc, v) => assertCents(acc + assertCents(v)), 0);
}

/** Line total = unit price x quantity, quantity must be a positive integer. */
export function lineTotalCents(unitPriceCents: number, quantity: number): number {
  assertCents(unitPriceCents, 'unitPriceCents');
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new MoneyError(`quantity must be a positive integer, got ${quantity}`);
  }
  return assertCents(unitPriceCents * quantity, 'lineTotal');
}

/**
 * Applies a rate expressed in basis points (1 bp = 0.01%) and rounds half away
 * from zero using integer arithmetic only, e.g. 8.25% of 1999 = 164.9175 -> 165.
 */
export function applyBasisPoints(cents: number, basisPoints: number): number {
  assertCents(cents);
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    throw new MoneyError(`basisPoints must be a non-negative integer, got ${basisPoints}`);
  }
  const sign = cents < 0 ? -1 : 1;
  const product = Math.abs(cents) * basisPoints;
  assertCents(product, 'intermediate product');
  const quotient = Math.floor(product / 10_000);
  const remainder = product % 10_000;
  return sign * (remainder * 2 >= 10_000 ? quotient + 1 : quotient);
}

export interface PricingPolicy {
  /** Sales tax rate in basis points, applied to the merchandise subtotal. */
  taxRateBps: number;
  /** Orders at or above this subtotal ship for free. */
  freeShippingThresholdCents: number;
  /** Flat shipping fee below the threshold. */
  flatShippingCents: number;
}

export const DEFAULT_PRICING: PricingPolicy = {
  taxRateBps: 825,
  freeShippingThresholdCents: 5_000,
  flatShippingCents: 599,
};

export interface PricedLine {
  unitPriceCents: number;
  quantity: number;
}

export interface OrderTotals {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

export function computeOrderTotals(
  lines: readonly PricedLine[],
  policy: PricingPolicy = DEFAULT_PRICING,
): OrderTotals {
  const subtotalCents = sumCents(lines.map((l) => lineTotalCents(l.unitPriceCents, l.quantity)));
  const shippingCents =
    subtotalCents === 0 || subtotalCents >= policy.freeShippingThresholdCents ? 0 : policy.flatShippingCents;
  const taxCents = applyBasisPoints(subtotalCents, policy.taxRateBps);
  return {
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: sumCents([subtotalCents, shippingCents, taxCents]),
  };
}

export function formatMoney(amountCents: number, currency: Currency = 'USD', locale = 'en-US'): string {
  assertCents(amountCents);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountCents / 100);
}
