import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';
import { RateLimiter } from './rate-limiter';

describe('password hashing (scrypt)', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects malformed hashes', async () => {
    expect(await verifyPassword('x', 'md5$abc')).toBe(false);
  });
});

describe('RateLimiter', () => {
  it('allows `limit` calls per window', () => {
    const rl = new RateLimiter(2, 1_000);
    expect(rl.take('ip', 0)).toBe(true);
    expect(rl.take('ip', 1)).toBe(true);
    expect(rl.take('ip', 2)).toBe(false);
    expect(rl.take('other', 2)).toBe(true);
    expect(rl.take('ip', 1_001)).toBe(true);
  });
});
