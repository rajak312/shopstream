import { describe, expect, it } from 'vitest';
import { afterCursorFilter, sortSpec, toCursor } from './pagination';

describe('keyset pagination', () => {
  it('chooses relevance only when searching', () => {
    expect(sortSpec('RELEVANCE', true)).toEqual({ field: 'score', direction: -1 });
    expect(sortSpec('RELEVANCE', false)).toEqual({ field: 'createdAt', direction: -1 });
    expect(sortSpec('PRICE_ASC', false)).toEqual({ field: 'priceCents', direction: 1 });
  });

  it('builds a strict (sortKey, _id) seek condition from a cursor', () => {
    const spec = sortSpec('PRICE_ASC', false);
    const cursor = toCursor(spec, { _id: 'p9', priceCents: 1999 });
    expect(afterCursorFilter(spec, cursor)).toEqual({
      $or: [{ priceCents: { $gt: 1999 } }, { priceCents: 1999, _id: { $gt: 'p9' } }],
    });
  });

  it('uses $lt for descending sorts and revives dates', () => {
    const spec = sortSpec('NEWEST', false);
    const at = new Date('2026-01-01T00:00:00.000Z');
    const filter = afterCursorFilter(spec, toCursor(spec, { _id: 'x', createdAt: at }));
    expect(filter).toEqual({ $or: [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: 'x' } }] });
  });

  it('ignores a cursor produced for a different sort order', () => {
    const cursor = toCursor(sortSpec('PRICE_ASC', false), { _id: 'p', priceCents: 1 });
    expect(afterCursorFilter(sortSpec('NAME_ASC', false), cursor)).toEqual({});
  });

  it('rejects garbage cursors', () => {
    expect(() => afterCursorFilter(sortSpec('NEWEST', false), '%%%')).toThrow('Invalid cursor');
  });
});
