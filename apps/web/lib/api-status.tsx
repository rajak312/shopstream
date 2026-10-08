'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { GATEWAY_URL } from './config';

export type ApiState = 'checking' | 'up' | 'waking' | 'down';

interface ApiStatus {
  state: ApiState;
  /** seconds since we started waiting for the API */
  waitedSeconds: number;
}

const ApiStatusContext = createContext<ApiStatus>({ state: 'checking', waitedSeconds: 0 });

const GIVE_UP_AFTER_MS = 4 * 60_000;

/**
 * The demo API runs on a free tier that sleeps after 15 minutes of inactivity.
 * We ping the gateway and, while the container boots, show a friendly
 * "waking up the services" state instead of a wall of errors.
 */
export function ApiStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ApiStatus>({ state: 'checking', waitedSeconds: 0 });

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const ping = async () => {
      let ok = false;
      try {
        // A trivial query proves the whole path works: gateway up and supergraph composed.
        const res = await fetch(GATEWAY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: '{ __typename }' }),
          signal: AbortSignal.timeout(8_000),
          cache: 'no-store',
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      if (cancelled) return;
      const waited = Date.now() - started;
      if (ok) {
        setStatus({ state: 'up', waitedSeconds: Math.round(waited / 1000) });
        timer = setTimeout(ping, 60_000);
        return;
      }
      setStatus({
        state: waited > GIVE_UP_AFTER_MS ? 'down' : 'waking',
        waitedSeconds: Math.round(waited / 1000),
      });
      timer = setTimeout(ping, waited > GIVE_UP_AFTER_MS ? 30_000 : 3_000);
    };
    void ping();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return <ApiStatusContext.Provider value={status}>{children}</ApiStatusContext.Provider>;
}

export const useApiStatus = () => useContext(ApiStatusContext);
