import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Header } from '@/components/header';
import { Providers } from '@/components/providers';
import { WakeBanner } from '@/components/wake-banner';
import { GITOPS_REPO_URL, REPO_URL, SITE_URL } from '@/lib/config';
import { themeScript } from '@/lib/theme';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-face' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'ShopStream — event-driven commerce', template: '%s · ShopStream' },
  description:
    'Event-driven e-commerce microservices demo: NestJS, Apollo Federation, MongoDB, PostgreSQL, NATS JetStream, sagas and a live event-flow visualizer.',
  openGraph: {
    title: 'ShopStream',
    description: 'Event-driven e-commerce microservices demo',
    url: SITE_URL,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans">
        <Providers>
          <WakeBanner />
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="border-t border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <p>
              ShopStream is a portfolio project by{' '}
              <a
                className="font-medium text-zinc-700 hover:underline dark:text-zinc-200"
                href="https://github.com/lalitkumarrajak"
              >
                Lalit Rajak
              </a>
              . No real payments — use the test cards at checkout.
            </p>
            <p className="mt-2 flex justify-center gap-4">
              <a className="hover:underline" href={REPO_URL}>
                Source
              </a>
              <a className="hover:underline" href={GITOPS_REPO_URL}>
                GitOps / Kubernetes
              </a>
              <Link className="hover:underline" href="/flow">
                Event flow
              </Link>
            </p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
