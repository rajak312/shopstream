'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeft,
  Ban,
  Check,
  CreditCard,
  Home,
  PackageCheck,
  Radio,
  RotateCcw,
  ShoppingCart,
  Truck,
  Warehouse,
  X,
} from 'lucide-react';
import Link from 'next/link';
import type { ComponentType } from 'react';
import { ProductImage } from '@/components/product-image';
import { Button, EmptyState, ErrorNote, Spinner, StatusBadge } from '@/components/ui';
import { gql } from '@/lib/graphql';
import { CANCEL_ORDER, ORDER } from '@/lib/queries';
import type { Order, Tone } from '@/lib/types';
import { useLiveOrderUpdates } from '@/lib/use-live-updates';
import { useRequireAuth } from '@/lib/use-require-auth';

type StepState = 'done' | 'active' | 'failed' | 'todo';

interface Step {
  label: string;
  icon: ComponentType<{ className?: string }>;
  state: StepState;
}

/** Derives the visual saga progress from the order's sub-statuses. */
function stepsFor(o: Order): Step[] {
  const cancelled = o.status === 'CANCELLED';
  const pay: StepState =
    o.paymentStatus === 'SUCCEEDED' || o.paymentStatus === 'REFUNDED'
      ? 'done'
      : o.paymentStatus === 'FAILED'
        ? 'failed'
        : cancelled
          ? 'todo'
          : 'active';
  const stock: StepState = ['RESERVED', 'COMMITTED', 'RELEASED'].includes(o.inventoryStatus)
    ? 'done'
    : o.inventoryStatus === 'REJECTED'
      ? 'failed'
      : cancelled
        ? 'todo'
        : 'active';
  const reached = (s: Order['status'][]) => s.includes(o.status);
  return [
    { label: 'Order placed', icon: ShoppingCart, state: 'done' },
    { label: 'Payment', icon: CreditCard, state: pay },
    { label: 'Stock reserved', icon: Warehouse, state: stock },
    {
      label: cancelled ? 'Cancelled' : 'Confirmed',
      icon: cancelled ? Ban : PackageCheck,
      state: cancelled ? 'failed' : reached(['CONFIRMED', 'SHIPPED', 'DELIVERED']) ? 'done' : 'todo',
    },
    ...(cancelled
      ? []
      : ([
          {
            label: 'Shipped',
            icon: Truck,
            state: reached(['SHIPPED', 'DELIVERED']) ? 'done' : o.status === 'CONFIRMED' ? 'active' : 'todo',
          },
          {
            label: 'Delivered',
            icon: Home,
            state: o.status === 'DELIVERED' ? 'done' : o.status === 'SHIPPED' ? 'active' : 'todo',
          },
        ] satisfies Step[])),
  ];
}

const stepStyle: Record<StepState, string> = {
  done: 'bg-emerald-500 text-white border-emerald-500',
  active: 'bg-white text-brand-600 border-brand-500 dark:bg-zinc-900 animate-pulse',
  failed: 'bg-rose-500 text-white border-rose-500',
  todo: 'bg-white text-zinc-400 border-zinc-300 dark:bg-zinc-900 dark:border-zinc-700',
};

const toneDot: Record<Tone, string> = {
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
};

const serviceColor: Record<string, string> = {
  orders: 'text-indigo-600 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-500/10',
  payments: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/10',
  catalog: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-500/10',
  notifications: 'text-fuchsia-700 bg-fuchsia-50 dark:text-fuchsia-300 dark:bg-fuchsia-500/10',
};

export function OrderView({ id }: { id: string }) {
  const { session } = useRequireAuth();
  const live = useLiveOrderUpdates();
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: async () => (await gql<{ order: Order | null }>(ORDER, { id })).order,
    enabled: Boolean(session),
    // SSE drives updates; polling is only a safety net.
    refetchInterval: (q) =>
      q.state.data && ['DELIVERED', 'CANCELLED'].includes(q.state.data.status) ? false : 5_000,
  });
  const cancel = useMutation({
    mutationFn: () => gql(CANCEL_ORDER, { id }),
    onSuccess: () => void order.refetch(),
  });

  if (!session || order.isPending) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (order.isError) return <ErrorNote error={order.error} />;
  const o = order.data;
  if (!o) return <EmptyState title="Order not found" />;
  const steps = stepsFor(o);

  return (
    <div className="space-y-6">
      <Link
        href="/orders"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        <ArrowLeft className="size-4" /> All orders
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Order {o.number}</h1>
        <StatusBadge status={o.status} />
        <span
          className={clsx(
            'ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
            live === 'live'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800',
          )}
        >
          <Radio className="size-3.5" /> {live === 'live' ? 'Live' : 'Connecting…'}
        </span>
      </div>

      <section className="card overflow-x-auto p-6">
        <ol className="flex min-w-[560px] items-start">
          {steps.map((s, i) => (
            <li key={s.label} className="flex flex-1 flex-col items-center text-center">
              <div className="flex w-full items-center">
                <span
                  className={clsx(
                    'h-0.5 flex-1',
                    i === 0
                      ? 'opacity-0'
                      : s.state === 'todo'
                        ? 'bg-zinc-200 dark:bg-zinc-800'
                        : 'bg-emerald-400',
                  )}
                />
                <span
                  className={clsx(
                    'grid size-10 place-items-center rounded-full border-2 transition-colors',
                    stepStyle[s.state],
                  )}
                >
                  {s.state === 'done' ? (
                    <Check className="size-5" />
                  ) : s.state === 'failed' ? (
                    <X className="size-5" />
                  ) : (
                    <s.icon className="size-4" />
                  )}
                </span>
                <span
                  className={clsx(
                    'h-0.5 flex-1',
                    i === steps.length - 1
                      ? 'opacity-0'
                      : steps[i + 1]?.state === 'todo'
                        ? 'bg-zinc-200 dark:bg-zinc-800'
                        : 'bg-emerald-400',
                  )}
                />
              </div>
              <span
                className={clsx(
                  'mt-2 text-xs font-medium',
                  s.state === 'failed' ? 'text-rose-600' : 'text-zinc-600 dark:text-zinc-300',
                )}
              >
                {s.label}
              </span>
            </li>
          ))}
        </ol>
        {o.status === 'CANCELLED' && (
          <p className="mt-5 flex items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            <RotateCcw className="size-4 shrink-0" /> Saga compensated —{' '}
            {(o.cancellationReason ?? 'cancelled').replace(/\.$/, '')}. Stock{' '}
            {o.inventoryStatus.toLowerCase()}, payment {o.paymentStatus.toLowerCase()}.
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="card p-6">
          <h2 className="mb-4 font-semibold">Event timeline</h2>
          {o.timeline.length === 0 ? (
            <p className="text-sm text-zinc-500">Waiting for the first events…</p>
          ) : (
            <ol className="relative space-y-5 border-l border-zinc-200 pl-6 dark:border-zinc-800">
              {o.timeline.map((t) => (
                <li key={t.id} className="relative animate-fade-in">
                  <span
                    className={clsx(
                      'absolute -left-[31px] top-1.5 size-3 rounded-full ring-4 ring-white dark:ring-zinc-900',
                      toneDot[t.tone],
                    )}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.title}</span>
                    <span
                      className={clsx(
                        'rounded px-1.5 py-0.5 font-mono text-[11px]',
                        serviceColor[t.source] ?? 'bg-zinc-100 dark:bg-zinc-800',
                      )}
                    >
                      {t.source}
                    </span>
                    <code className="font-mono text-[11px] text-zinc-400">{t.type}</code>
                    <span className="ml-auto text-xs tabular-nums text-zinc-400">
                      {new Date(t.occurredAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{t.detail}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
        <aside className="space-y-6">
          <section className="card space-y-3 p-5">
            <h2 className="font-semibold">Items</h2>
            {o.items.map((i) => (
              <div key={i.productId} className="flex items-center gap-3">
                <div className="w-12 shrink-0">
                  <ProductImage src={i.imageUrl} alt={i.name} />
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium">{i.name}</p>
                  <p className="text-zinc-500">
                    {i.quantity} × {i.unitPrice.formatted}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">{i.lineTotal.formatted}</span>
              </div>
            ))}
            <div className="space-y-1 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
              <Line label="Subtotal" value={o.subtotal.formatted} />
              <Line label="Shipping" value={o.shipping.amountCents === 0 ? 'Free' : o.shipping.formatted} />
              <Line label="Tax" value={o.tax.formatted} />
              <div className="flex justify-between pt-1 font-bold">
                <span>Total</span>
                <span>{o.total.formatted}</span>
              </div>
            </div>
          </section>
          <section className="card space-y-2 p-5 text-sm">
            <h2 className="font-semibold">Payment</h2>
            <Line label="Card" value={`${o.card.brand.toUpperCase()} •••• ${o.card.last4}`} />
            <Line label="Status" value={o.payment?.status ?? o.paymentStatus} />
            {o.payment && <Line label="Processor attempts" value={String(o.payment.attempts)} />}
            {o.payment?.failureMessage && <p className="text-rose-600">{o.payment.failureMessage}</p>}
          </section>
          {o.canCancel && (
            <Button
              variant="danger"
              className="w-full"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending && <Spinner />} Cancel order
            </Button>
          )}
          <ErrorNote error={cancel.error} />
        </aside>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-zinc-600 dark:text-zinc-300">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
