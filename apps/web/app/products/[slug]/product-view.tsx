'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Layers, Minus, Plus, Star, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ProductImage } from '@/components/product-image';
import { Button, EmptyState, ErrorNote, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { gql } from '@/lib/graphql';
import { useCartMutations } from '@/lib/hooks';
import { PRODUCT_BY_SLUG } from '@/lib/queries';
import type { ProductDetail } from '@/lib/types';

export function ProductView({ slug }: { slug: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const { add } = useCartMutations();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const product = useQuery({
    queryKey: ['product', slug],
    queryFn: async () =>
      (await gql<{ productBySlug: ProductDetail | null }>(PRODUCT_BY_SLUG, { slug })).productBySlug,
  });

  if (product.isPending) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (product.isError) return <ErrorNote error={product.error} />;
  const p = product.data;
  if (!p)
    return <EmptyState title="Product not found">It may have been removed from the catalog.</EmptyState>;

  const onAdd = async () => {
    if (!session) {
      router.push(`/login?next=/products/${slug}`);
      return;
    }
    await add.mutateAsync({ productId: p.id, quantity: qty });
    setAdded(true);
    setTimeout(() => setAdded(false), 2_000);
  };

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        <ArrowLeft className="size-4" /> Back to the shop
      </Link>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="card p-4">
          <ProductImage src={p.imageUrl} alt={p.name} />
        </div>
        <div className="flex flex-col gap-5">
          <div className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-wide text-brand-600 dark:text-brand-400">
              {p.category.name}
            </p>
            <h1 className="text-3xl font-bold tracking-tight">{p.name}</h1>
            <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1">
                <Star className="size-4 fill-amber-400 text-amber-400" /> {p.rating.toFixed(1)} ·{' '}
                {p.reviewCount} reviews
              </span>
              <span>SKU {p.sku}</span>
            </div>
          </div>
          <p className="text-3xl font-bold">{p.price.formatted}</p>
          <p className="leading-relaxed text-zinc-600 dark:text-zinc-300">{p.description}</p>
          <div className="flex flex-wrap gap-2">
            {p.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                #{t}
              </span>
            ))}
          </div>
          <div className="card space-y-4 p-5">
            <div className="flex items-center justify-between text-sm">
              <span
                className={
                  p.inStock
                    ? 'font-medium text-emerald-600 dark:text-emerald-400'
                    : 'font-medium text-rose-600'
                }
              >
                {p.inStock ? `${p.available} in stock` : 'Sold out'}
              </span>
              <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                <Truck className="size-4" /> Free shipping over $50
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center rounded-lg border border-zinc-300 dark:border-zinc-700">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  className="p-2.5"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                >
                  <Minus className="size-4" />
                </button>
                <span className="w-8 text-center font-semibold tabular-nums">{qty}</span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  className="p-2.5"
                  onClick={() => setQty((q) => Math.min(10, q + 1))}
                >
                  <Plus className="size-4" />
                </button>
              </div>
              <Button
                className="flex-1 py-2.5"
                disabled={!p.inStock || add.isPending}
                onClick={() => void onAdd()}
              >
                {add.isPending ? <Spinner /> : added ? <Check className="size-4" /> : null}
                {added ? 'Added to cart' : 'Add to cart'}
              </Button>
            </div>
            {added && (
              <Link
                href="/cart"
                className="block text-center text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                View cart & check out →
              </Link>
            )}
            <ErrorNote error={add.error} />
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <Layers className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-medium text-zinc-700 dark:text-zinc-200">Federated query:</span> name,
              price and stock come from the <code className="font-mono text-xs">catalog</code> subgraph
              (MongoDB); “{p.unitsSold} sold” is contributed to the same{' '}
              <code className="font-mono text-xs">Product</code> entity by the{' '}
              <code className="font-mono text-xs">orders</code> subgraph (PostgreSQL) — one request through
              the gateway.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
