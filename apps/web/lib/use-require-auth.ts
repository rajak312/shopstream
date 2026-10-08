'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from './auth';

/** Sends anonymous visitors to /login and back afterwards. */
export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (auth.ready && !auth.session) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [auth.ready, auth.session, router, pathname]);
  return auth;
}
