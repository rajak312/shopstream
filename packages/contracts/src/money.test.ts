import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  addMoney,
  applyBasisPoints,
  computeOrderTotals,
  formatMoney,
  lineTotalCents,
  money,
  sumCents,
} from './money';

describe('money', () => {
  it('rejects fractional or unsafe cent amounts', () => {
    expect(() => money(10.5)).toThrow(MoneyError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
    expect(money(1999)).toEqual({ amountCents: 1999, currency: 'USD' });
  });

  it('adds money of the same currency only', () => {
    expect(addMoney(money(100), money(250))).toEqual(money(350));
  });

  it('never suffers from floating point drift (0.1 + 0.2)', () => {
    expect(sumCents([10, 20])).toBe(30);
    expect(sumCents(Array.from({ length: 1000 }, () => 1))).toBe(1000);
  });

  it('multiplies unit price by a positive integer quantity', () => {
    expect(lineTotalCents(1999, 3)).toBe(5997);
    expect(() => lineTotalCents(1999, 0)).toThrow(MoneyError);
    expect(() => lineTotalCents(1999, 1.5)).toThrow(MoneyError);
  });

  it.each([
    [1999, 825, 165], // 164.9175 -> 165
    [1000, 825, 83], // 82.5 -> 83 (half away from zero)
    [100, 50, 1], // 0.5 -> 1
    [100, 49, 0], // 0.49 -> 0
    [-1000, 825, -83], // symmetric for refunds
    [0, 825, 0],
  ])('applyBasisPoints(%i, %i) = %i', (cents, bps, expected) => {
    expect(applyBasisPoints(cents, bps)).toBe(expected);
  });

  it('computes order totals with free shipping above the threshold', () => {
    const small = computeOrderTotals([{ unitPriceCents: 1900, quantity: 1 }]);
    expect(small).toEqual({ subtotalCents: 1900, shippingCents: 599, taxCents: 157, totalCents: 2656 });

    const large = computeOrderTotals([
      { unitPriceCents: 2900, quantity: 1 },
      { unitPriceCents: 2400, quantity: 1 },
    ]);
    expect(large.shippingCents).toBe(0);
    expect(large.totalCents).toBe(large.subtotalCents + large.taxCents);
  });

  it('charges nothing for an empty cart', () => {
    expect(computeOrderTotals([])).toEqual({
      subtotalCents: 0,
      shippingCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });

  it('formats cents as currency', () => {
    expect(formatMoney(189900)).toBe('$1,899.00');
    expect(formatMoney(5)).toBe('$0.05');
  });
});
