'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { ProductImage } from '@/components/product-image';
import { EmptyState, ErrorNote, Spinner, buttonClass } from '@/components/ui';
import { useCart, useCartMutations } from '@/lib/hooks';
import { useRequireAuth } from '@/lib/use-require-auth';

export default function CartPage() {
  const { session } = useRequireAuth();
  const cart = useCart();
  const { update } = useCartMutations();

  if (!session || cart.isPending) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (cart.isError) return <ErrorNote error={cart.error} />;
  const c = cart.data;
  if (!c || c.items.length === 0) {
    return (
      <EmptyState title="Your cart is empty">
        <Link href="/" className={buttonClass('primary', 'mt-2')}>
          Start shopping
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Your cart</h1>
        <ul className="card divide-y divide-zinc-200 dark:divide-zinc-800">
          {c.items.map((item) => (
            <li key={item.productId} className="flex items-center gap-4 p-4">
              <Link href={`/products/${item.product.slug}`} className="w-20 shrink-0">
                <ProductImage src={item.imageUrl} alt={item.name} />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/products/${item.product.slug}`} className="font-semibold hover:underline">
                  {item.name}
                </Link>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{item.unitPrice.formatted} each</p>
              </div>
              <div className="flex items-center rounded-lg border border-zinc-300 dark:border-zinc-700">
                <button
                  type="button"
                  aria-label="Decrease"
                  className="p-2"
                  onClick={() => update.mutate({ productId: item.productId, quantity: item.quantity - 1 })}
                >
                  {item.quantity === 1 ? <Trash2 className="size-4" /> : <Minus className="size-4" />}
                </button>
                <span className="w-7 text-center text-sm font-semibold tabular-nums">{item.quantity}</span>
                <button
                  type="button"
                  aria-label="Increase"
                  className="p-2 disabled:opacity-40"
                  disabled={item.quantity >= 10}
                  onClick={() => update.mutate({ productId: item.productId, quantity: item.quantity + 1 })}
                >
                  <Plus className="size-4" />
                </button>
              </div>
              <span className="w-24 text-right font-semibold tabular-nums">{item.lineTotal.formatted}</span>
            </li>
          ))}
        </ul>
        <ErrorNote error={update.error} />
      </div>
      <aside className="card h-fit space-y-3 p-5">
        <h2 className="font-semibold">Summary</h2>
        <Row label={`Subtotal (${c.itemCount} items)`} value={c.subtotal.formatted} />
        <Row
          label="Shipping"
          value={c.estimatedShipping.amountCents === 0 ? 'Free' : c.estimatedShipping.formatted}
        />
        <Row label="Tax (8.25%)" value={c.estimatedTax.formatted} />
        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <Row label="Total" value={c.estimatedTotal.formatted} strong />
        </div>
        <Link href="/checkout" className={buttonClass('primary', 'w-full py-2.5')}>
          Checkout
        </Link>
      </aside>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex justify-between text-sm ${strong ? 'text-base font-bold' : 'text-zinc-600 dark:text-zinc-300'}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
