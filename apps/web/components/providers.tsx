'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiStatusProvider } from '@/lib/api-status';
import { AuthProvider } from '@/lib/auth';
import { GraphQLRequestError } from '@/lib/graphql';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            // Keep retrying network errors while a cold free-tier API boots; fail fast on real errors.
            retry: (count, err) =>
              err instanceof GraphQLRequestError && err.network ? count < 20 : count < 1,
            retryDelay: (n) => Math.min(1_000 * 2 ** n, 5_000),
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ApiStatusProvider>
        <AuthProvider>{children}</AuthProvider>
      </ApiStatusProvider>
    </QueryClientProvider>
  );
}
