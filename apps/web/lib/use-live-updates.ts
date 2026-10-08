'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { API_ORIGIN } from './config';
import type { TimelineEntry } from './types';

export type LiveState = 'connecting' | 'live' | 'reconnecting';

/**
 * Subscribes to the user's live event stream (SSE via the gateway) and
 * refreshes the affected order whenever a saga step lands.
 */
export function useLiveOrderUpdates(onEntry?: (orderId: string, entry: TimelineEntry) => void): LiveState {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');
  const token = session?.token;

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`${API_ORIGIN}/events/me?access_token=${encodeURIComponent(token)}`);
    es.addEventListener('ready', () => setState('live'));
    es.addEventListener('timeline', (e) => {
      const msg = JSON.parse((e as MessageEvent<string>).data) as { orderId: string; entry: TimelineEntry };
      onEntry?.(msg.orderId, msg.entry);
      void qc.invalidateQueries({ queryKey: ['order', msg.orderId] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    });
    es.onerror = () => setState('reconnecting');
    return () => es.close();
  }, [token, qc, onEntry]);

  return state;
}
