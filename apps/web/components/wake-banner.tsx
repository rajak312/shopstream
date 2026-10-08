'use client';

import { useApiStatus } from '@/lib/api-status';
import { Spinner } from './ui';

export function WakeBanner() {
  const { state, waitedSeconds } = useApiStatus();
  if (state === 'up') return null;
  if (state === 'checking') return null;
  if (state === 'down') {
    return (
      <div className="border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-center text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200">
        The API is not responding right now. Please try again in a few minutes.
      </div>
    );
  }
  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-3">
        <Spinner />
        <span>
          <strong>Waking up the services…</strong> The demo backend runs on a free tier that sleeps when idle.
          Cold starts take about 30–60 seconds{waitedSeconds > 3 ? ` (${waitedSeconds}s so far)` : ''}.
        </span>
      </div>
    </div>
  );
}
