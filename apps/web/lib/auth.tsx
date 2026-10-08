'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { TOKEN_KEY, gql } from './graphql';
import { DEMO_LOGIN, LOGIN, REGISTER } from './queries';
import type { AuthPayload, User } from './types';

const USER_KEY = 'shopstream.user';

interface Session {
  token: string;
  user: User;
}

interface AuthContextValue {
  session: Session | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  demoLogin(): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// --- tiny external store over localStorage so every tab/component stays in sync
const listeners = new Set<() => void>();
let cached: { raw: string | null; session: Session | null } = { raw: null, session: null };

function readSession(): Session | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const user = localStorage.getItem(USER_KEY);
    const raw = token && user ? `${token}|${user}` : null;
    if (raw === cached.raw) return cached.session;
    let session: Session | null = null;
    if (token && user) {
      const parsed = JSON.parse(user) as User;
      const exp = decodeExpiry(token);
      session = exp && exp < Date.now() ? null : { token, user: parsed };
    }
    cached = { raw, session };
    return session;
  } catch {
    return null;
  }
}

function decodeExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function writeSession(p: AuthPayload | null) {
  try {
    if (p) {
      localStorage.setItem(TOKEN_KEY, p.token);
      localStorage.setItem(USER_KEY, JSON.stringify(p.user));
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOKEN_KEY || e.key === USER_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const MOUNTED = () => true;
const NOT_MOUNTED = () => false;
const noopSubscribe = () => () => undefined;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useSyncExternalStore(subscribe, readSession, () => null);
  const ready = useSyncExternalStore(noopSubscribe, MOUNTED, NOT_MOUNTED);

  const apply = useCallback(
    (p: AuthPayload | null) => {
      writeSession(p);
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      ready,
      login: async (email, password) =>
        apply((await gql<{ login: AuthPayload }>(LOGIN, { email, password })).login),
      register: async (name, email, password) =>
        apply((await gql<{ register: AuthPayload }>(REGISTER, { name, email, password })).register),
      demoLogin: async () => apply((await gql<{ demoLogin: AuthPayload }>(DEMO_LOGIN)).demoLogin),
      logout: () => {
        writeSession(null);
        queryClient.clear();
      },
    }),
    [session, ready, apply, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
