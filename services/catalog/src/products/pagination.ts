import { decodeCursor, encodeCursor } from '@shopstream/platform';

export type ProductSort = 'RELEVANCE' | 'NEWEST' | 'PRICE_ASC' | 'PRICE_DESC' | 'NAME_ASC';

export interface SortSpec {
  field: 'score' | 'createdAt' | 'priceCents' | 'name';
  direction: 1 | -1;
}

export function sortSpec(sort: ProductSort, hasSearch: boolean): SortSpec {
  switch (sort) {
    case 'RELEVANCE':
      return hasSearch ? { field: 'score', direction: -1 } : { field: 'createdAt', direction: -1 };
    case 'PRICE_ASC':
      return { field: 'priceCents', direction: 1 };
    case 'PRICE_DESC':
      return { field: 'priceCents', direction: -1 };
    case 'NAME_ASC':
      return { field: 'name', direction: 1 };
    case 'NEWEST':
    default:
      return { field: 'createdAt', direction: -1 };
  }
}

interface CursorPayload {
  /** sort field the cursor was produced for, so a cursor can't be replayed with another sort */
  f: SortSpec['field'];
  v: string | number;
  id: string;
}

export function toCursor(spec: SortSpec, doc: Record<string, unknown> & { _id: string }): string {
  const raw = doc[spec.field];
  const v = raw instanceof Date ? raw.toISOString() : (raw as string | number);
  return encodeCursor({ f: spec.field, v, id: doc._id } satisfies CursorPayload);
}

/**
 * Keyset ("seek") condition: rows strictly after the cursor in (sortKey, _id)
 * order. Stable under concurrent inserts and O(log n) with the compound indexes.
 */
export function afterCursorFilter(spec: SortSpec, cursor: string | undefined): Record<string, unknown> {
  if (!cursor) return {};
  const c = decodeCursor<CursorPayload>(cursor);
  if (c.f !== spec.field) return {};
  const value = spec.field === 'createdAt' ? new Date(String(c.v)) : c.v;
  const op = spec.direction === 1 ? '$gt' : '$lt';
  return { $or: [{ [spec.field]: { [op]: value } }, { [spec.field]: value, _id: { [op]: c.id } }] };
}
