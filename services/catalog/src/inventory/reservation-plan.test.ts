import { describe, expect, it } from 'vitest';
import { compensationFor, planReservation } from './reservation-plan';

describe('planReservation', () => {
  const stock = new Map([
    ['a', 5],
    ['b', 1],
  ]);

  it('reserves when every line is available', () => {
    expect(planReservation([{ productId: 'a', quantity: 5 }], stock)).toEqual({
      kind: 'reserve',
      lines: [{ productId: 'a', quantity: 5 }],
    });
  });

  it('is all-or-nothing and reports what is missing', () => {
    expect(
      planReservation(
        [
          { productId: 'a', quantity: 1 },
          { productId: 'b', quantity: 2 },
          { productId: 'zz', quantity: 1 },
        ],
        stock,
      ),
    ).toEqual({
      kind: 'reject',
      unavailable: [
        { productId: 'b', requested: 2, available: 1 },
        { productId: 'zz', requested: 1, available: 0 },
      ],
    });
  });

  it('merges duplicate lines before checking stock', () => {
    const plan = planReservation(
      [
        { productId: 'a', quantity: 3 },
        { productId: 'a', quantity: 3 },
      ],
      stock,
    );
    expect(plan).toEqual({ kind: 'reject', unavailable: [{ productId: 'a', requested: 6, available: 5 }] });
  });
});

describe('compensationFor (order.cancelled)', () => {
  it('releases a live reservation', () => expect(compensationFor('RESERVED')).toBe('release'));
  it('leaves a tombstone when the cancel overtakes order.created', () =>
    expect(compensationFor(undefined)).toBe('tombstone'));
  it.each(['REJECTED', 'RELEASED', 'COMMITTED', 'CANCELLED'])('does nothing for %s', (s) =>
    expect(compensationFor(s)).toBe('none'),
  );
});
