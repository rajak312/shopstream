'use client';

import { Sparkles } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export function LoginForm() {
  const auth = useAuth();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'form' | 'demo' | null>(null);

  const run = async (kind: 'form' | 'demo', fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      router.replace(target);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run('form', () =>
      mode === 'login'
        ? auth.login(form.email, form.password)
        : auth.register(form.name, form.email, form.password),
    );
  };

  return (
    <div className="mx-auto max-w-md space-y-6 py-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          {mode === 'login' ? 'Welcome back' : 'Create an account'}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Authentication is handled at the GraphQL gateway (JWT).
        </p>
      </div>
      <div className="card space-y-5 p-6">
        <Button
          className="w-full py-2.5"
          disabled={busy !== null}
          onClick={() => void run('demo', auth.demoLogin)}
        >
          {busy === 'demo' ? <Spinner /> : <Sparkles className="size-4" />} Continue as the demo shopper
        </Button>
        <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
          or use <span className="font-mono">demo@shopstream.dev</span> /{' '}
          <span className="font-mono">demo-password</span>
        </p>
        <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" /> or{' '}
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <form className="space-y-3" onSubmit={submit}>
          {mode === 'register' && (
            <input
              className="input"
              placeholder="Your name"
              autoComplete="name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
          <input
            className="input"
            type="email"
            placeholder="Email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            className="input"
            type="password"
            placeholder="Password (8+ characters)"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <ErrorNote error={error} />
          <Button type="submit" variant="secondary" className="w-full" disabled={busy !== null}>
            {busy === 'form' && <Spinner />} {mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
          {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
          <button
            type="button"
            className="font-semibold text-brand-600 hover:underline dark:text-brand-400"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
