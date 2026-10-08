'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Activity, Search } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { ProductCard } from '@/components/product-card';
import { EmptyState, ErrorNote, Spinner, buttonClass } from '@/components/ui';
import { gql } from '@/lib/graphql';
import { CATEGORIES, PRODUCTS } from '@/lib/queries';
import type { Category, ProductPage } from '@/lib/types';

const SORTS = [
  { value: 'NEWEST', label: 'Newest' },
  { value: 'PRICE_ASC', label: 'Price: low to high' },
  { value: 'PRICE_DESC', label: 'Price: high to low' },
  { value: 'NAME_ASC', label: 'Name' },
] as const;

export function Storefront() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<string>('NEWEST');
  const [inStockOnly, setInStockOnly] = useState(false);
  const deferredSearch = useDeferredValue(search.trim());

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await gql<{ categories: Category[] }>(CATEGORIES)).categories,
    staleTime: 5 * 60_000,
  });

  const products = useInfiniteQuery({
    queryKey: ['products', deferredSearch, category, sort, inStockOnly],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      (
        await gql<{ products: ProductPage }>(PRODUCTS, {
          first: 12,
          after: pageParam,
          sort: deferredSearch && sort === 'NEWEST' ? 'RELEVANCE' : sort,
          filter: { search: deferredSearch || null, categorySlug: category, inStockOnly },
        })
      ).products,
    getNextPageParam: (last) => (last.pageInfo.hasNextPage ? last.pageInfo.endCursor : null),
  });

  const items = products.data?.pages.flatMap((p) => p.edges.map((e) => e.node)) ?? [];
  const total = products.data?.pages[0]?.totalCount ?? 0;

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-indigo-600 to-fuchsia-600 px-6 py-10 text-white shadow-lg sm:px-10">
        <div className="absolute -right-10 -top-10 size-64 rounded-full bg-white/10 blur-2xl" />
        <div className="relative max-w-2xl space-y-4">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider">
            <Activity className="size-3.5" /> Event-driven microservices demo
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Every click is an event.</h1>
          <p className="text-white/85">
            Browse, check out with a test card and watch the order travel through five NestJS services, a NATS
            JetStream broker and a saga — live.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/flow" className={buttonClass('secondary', 'border-transparent')}>
              Open the event-flow visualizer
            </Link>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Search products</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              className="input pl-9"
              placeholder="Search headphones, coffee, tents…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
                className="accent-brand-600"
              />
              In stock
            </label>
            <select
              className="input w-auto"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort products"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip active={category === null} onClick={() => setCategory(null)}>
            All
          </Chip>
          {categories.data?.map((c) => (
            <Chip key={c.slug} active={category === c.slug} onClick={() => setCategory(c.slug)}>
              {c.name} <span className="opacity-60">{c.productCount}</span>
            </Chip>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {products.isPending ? 'Loading products…' : `${total} product${total === 1 ? '' : 's'}`}
        </p>
        {products.isError && <ErrorNote error={products.error} />}
        {products.isPending ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="card aspect-[3/4] animate-pulse bg-zinc-100 dark:bg-zinc-900" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="No products match">Try another search or clear the filters.</EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
        {products.hasNextPage && (
          <div className="flex justify-center pt-4">
            <button
              type="button"
              className={buttonClass('secondary')}
              disabled={products.isFetchingNextPage}
              onClick={() => void products.fetchNextPage()}
            >
              {products.isFetchingNextPage && <Spinner />} Load more
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900'
          : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
      )}
    >
      {children}
    </button>
  );
}
