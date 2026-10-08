'use client';

import clsx from 'clsx';
import { Activity, LogOut, Moon, Package, ShoppingBag, Sun, User as UserIcon, Zap } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/hooks';
import { toggleTheme } from '@/lib/theme';

const nav = [
  { href: '/', label: 'Shop', icon: ShoppingBag },
  { href: '/orders', label: 'Orders', icon: Package },
  { href: '/flow', label: 'Event flow', icon: Activity },
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, logout, ready } = useAuth();
  const cart = useCart();
  const [, force] = useState(0);
  const count = cart.data?.itemCount ?? 0;

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/80 backdrop-blur-lg dark:border-zinc-800/80 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white shadow-sm">
            <Zap className="size-4" />
          </span>
          <span className="text-lg">ShopStream</span>
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {nav.map(({ href, label, icon: Icon }) => {
            const active =
              href === '/' ? pathname === '/' || pathname.startsWith('/products') : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white'
                    : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white',
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-label="Toggle dark mode"
            onClick={() => {
              toggleTheme();
              force((n) => n + 1);
            }}
            className="grid size-9 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Sun className="hidden size-4 dark:block" />
            <Moon className="size-4 dark:hidden" />
          </button>
          <Link
            href="/cart"
            aria-label={`Cart with ${count} items`}
            className="relative grid size-9 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <ShoppingBag className="size-4" />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold leading-4 text-white">
                {count}
              </span>
            )}
          </Link>
          {ready && session ? (
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-lg px-2 text-sm text-zinc-600 md:flex dark:text-zinc-300">
                <UserIcon className="size-4" />
                {session.user.name}
              </span>
              <button
                type="button"
                aria-label="Sign out"
                onClick={() => {
                  logout();
                  router.push('/');
                }}
                className="grid size-9 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(pathname)}`}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
      <nav className="flex justify-center gap-1 border-t border-zinc-200/60 py-1.5 sm:hidden dark:border-zinc-800/60">
        {nav.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="rounded-md px-3 py-1 text-sm text-zinc-600 dark:text-zinc-300"
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
