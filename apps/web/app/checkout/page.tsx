'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CreditCard, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, EmptyState, ErrorNote, Spinner } from '@/components/ui';
import { gql } from '@/lib/graphql';
import { useCart } from '@/lib/hooks';
import { CHECKOUT, TEST_CARDS } from '@/lib/queries';
import type { TestCard } from '@/lib/types';
import { useRequireAuth } from '@/lib/use-require-auth';

const outcomeColor: Record<string, string> = {
  succeeded: 'text-emerald-600 dark:text-emerald-400',
  declined: 'text-rose-600 dark:text-rose-400',
  insufficient_funds: 'text-rose-600 dark:text-rose-400',
  flaky: 'text-amber-600 dark:text-amber-400',
};

const formatCard = (n: string) =>
  n
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(.{4})/g, '$1 ')
    .trim();

export default function CheckoutPage() {
  const { session } = useRequireAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const cart = useCart();
  const cards = useQuery({
    queryKey: ['test-cards'],
    queryFn: async () => (await gql<{ testCards: TestCard[] }>(TEST_CARDS)).testCards,
    staleTime: Infinity,
    enabled: Boolean(session),
  });
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [card, setCard] = useState({ number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' });
  const [address, setAddress] = useState({
    name: session?.user.name ?? 'Demo Shopper',
    line1: '221B Baker Street',
    city: 'London',
    postalCode: 'NW1 6XE',
    country: 'GB',
  });

  const checkout = useMutation({
    mutationFn: async () =>
      (
        await gql<{ checkout: { id: string } }>(CHECKOUT, {
          input: {
            cardNumber: card.number,
            cardExpiry: card.expiry,
            cardCvc: card.cvc,
            idempotencyKey,
            shippingAddress: address,
          },
        })
      ).checkout,
    onSuccess: (order) => {
      void qc.invalidateQueries({ queryKey: ['cart'] });
      router.push(`/orders/${order.id}`);
    },
  });

  if (!session || cart.isPending) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!cart.data?.items.length && !checkout.isSuccess)
    return <EmptyState title="Nothing to check out">Your cart is empty.</EmptyState>;
  const c = cart.data!;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    checkout.mutate();
  };

  return (
    <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">Shipping address</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input sm:col-span-2"
              aria-label="Full name"
              required
              value={address.name}
              onChange={(e) => setAddress({ ...address, name: e.target.value })}
            />
            <input
              className="input sm:col-span-2"
              aria-label="Address"
              required
              value={address.line1}
              onChange={(e) => setAddress({ ...address, line1: e.target.value })}
            />
            <input
              className="input"
              aria-label="City"
              required
              value={address.city}
              onChange={(e) => setAddress({ ...address, city: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                className="input"
                aria-label="Postal code"
                required
                value={address.postalCode}
                onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
              />
              <input
                className="input uppercase"
                aria-label="Country (2 letters)"
                required
                maxLength={2}
                value={address.country}
                onChange={(e) => setAddress({ ...address, country: e.target.value })}
              />
            </div>
          </div>
        </section>
        <section className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Payment</h2>
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <Lock className="size-3.5" /> Simulated processor — never enter a real card
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {cards.data?.map((t) => (
              <button
                type="button"
                key={t.number}
                onClick={() => setCard({ ...card, number: formatCard(t.number) })}
                className={clsx(
                  'rounded-xl border p-3 text-left text-sm transition',
                  card.number.replace(/\s/g, '') === t.number
                    ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/30 dark:bg-brand-500/10'
                    : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700',
                )}
              >
                <span className={clsx('font-semibold', outcomeColor[t.outcome])}>{t.label}</span>
                <span className="mt-0.5 block font-mono text-xs text-zinc-500">{formatCard(t.number)}</span>
                <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{t.description}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_90px_80px] gap-3">
            <label className="relative">
              <CreditCard className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                className="input pl-9 font-mono"
                aria-label="Card number"
                inputMode="numeric"
                required
                value={card.number}
                onChange={(e) => setCard({ ...card, number: formatCard(e.target.value) })}
              />
            </label>
            <input
              className="input font-mono"
              aria-label="Expiry MM/YY"
              placeholder="MM/YY"
              required
              value={card.expiry}
              onChange={(e) => setCard({ ...card, expiry: e.target.value })}
            />
            <input
              className="input font-mono"
              aria-label="CVC"
              placeholder="CVC"
              required
              value={card.cvc}
              onChange={(e) => setCard({ ...card, cvc: e.target.value })}
            />
          </div>
        </section>
      </div>
      <aside className="card h-fit space-y-3 p-5">
        <h2 className="font-semibold">Order summary</h2>
        <ul className="space-y-2 text-sm">
          {c.items.map((i) => (
            <li key={i.productId} className="flex justify-between gap-2 text-zinc-600 dark:text-zinc-300">
              <span className="truncate">
                {i.quantity} × {i.name}
              </span>
              <span className="tabular-nums">{i.lineTotal.formatted}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
          <div className="flex justify-between text-zinc-600 dark:text-zinc-300">
            <span>Shipping</span>
            <span>{c.estimatedShipping.amountCents === 0 ? 'Free' : c.estimatedShipping.formatted}</span>
          </div>
          <div className="flex justify-between text-zinc-600 dark:text-zinc-300">
            <span>Tax</span>
            <span>{c.estimatedTax.formatted}</span>
          </div>
          <div className="flex justify-between pt-1 text-base font-bold">
            <span>Total</span>
            <span>{c.estimatedTotal.formatted}</span>
          </div>
        </div>
        <ErrorNote error={checkout.error} />
        <Button type="submit" className="w-full py-2.5" disabled={checkout.isPending || checkout.isSuccess}>
          {(checkout.isPending || checkout.isSuccess) && <Spinner />} Place order ·{' '}
          {c.estimatedTotal.formatted}
        </Button>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          The order is accepted immediately (PENDING). Payment and stock reservation then run in parallel as
          events — watch it live on the next page.
        </p>
      </aside>
    </form>
  );
}
