import { describe, expect, it } from 'vitest';
import { bearerToken, signAccessToken, userFromAuthorization, verifyAccessToken } from './auth';

const secret = 'test-secret-at-least-16-chars';
const user = { id: 'u-1', email: 'a@b.c', name: 'A', role: 'CUSTOMER' as const };

describe('auth', () => {
  it('signs and verifies a token round trip', async () => {
    const token = await signAccessToken(user, secret);
    expect(await verifyAccessToken(token, secret)).toEqual(user);
  });

  it('rejects tampered, foreign and expired tokens', async () => {
    const token = await signAccessToken(user, secret);
    expect(await verifyAccessToken(token, 'another-secret-of-16+')).toBeNull();
    expect(await verifyAccessToken(`${token}x`, secret)).toBeNull();
    const expired = await signAccessToken(user, secret, -10);
    expect(await verifyAccessToken(expired, secret)).toBeNull();
  });

  it('parses bearer headers', async () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
    expect(await userFromAuthorization(`Bearer ${await signAccessToken(user, secret)}`, secret)).toEqual(
      user,
    );
  });
});
