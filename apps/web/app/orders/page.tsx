'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { ProductImage } from '@/components/product-image';
import { EmptyState, ErrorNote, Spinner, StatusBadge, buttonClass } from '@/components/ui';
import { gql } from '@/lib/graphql';
import { MY_ORDERS } from '@/lib/queries';
import type { Money, OrderStatus } from '@/lib/types';
import { useLiveOrderUpdates } from '@/lib/use-live-updates';
import { useRequireAuth } from '@/lib/use-require-auth';

interface OrderSummary {
  id: string;
  number: string;
  status: OrderStatus;
  paymentStatus: string;
  createdAt: string;
  total: Money;
  items: { name: string; quantity: number; imageUrl: string }[];
}

export default function OrdersPage() {
  const { session } = useRequireAuth();
  useLiveOrderUpdates();
  const orders = useQuery({
    queryKey: ['orders', session?.user.id],
    queryFn: async () =>
      (await gql<{ myOrders: { totalCount: number; edges: { node: OrderSummary }[] } }>(MY_ORDERS)).myOrders,
    enabled: Boolean(session),
  });

  if (!session || orders.isPending) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (orders.isError) return <ErrorNote error={orders.error} />;
  const list = orders.data.edges.map((e) => e.node);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Your orders</h1>
      {list.length === 0 ? (
        <EmptyState title="No orders yet">
          <Link href="/" className={buttonClass('primary', 'mt-2')}>
            Find something nice
          </Link>
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-zinc-200 dark:divide-zinc-800">
          {list.map((o) => (
            <li key={o.id}>
              <Link
                href={`/orders/${o.id}`}
                className="flex items-center gap-4 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
              >
                <div className="flex -space-x-3">
                  {o.items.slice(0, 3).map((i) => (
                    <div key={i.name} className="w-11 rounded-xl ring-2 ring-white dark:ring-zinc-900">
                      <ProductImage src={i.imageUrl} alt={i.name} />
                    </div>
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{o.number}</p>
                  <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                    {new Date(o.createdAt).toLocaleString()} ·{' '}
                    {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                  </p>
                </div>
                <StatusBadge status={o.status} />
                <span className="w-24 text-right font-semibold tabular-nums">{o.total.formatted}</span>
                <ChevronRight className="size-4 text-zinc-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
