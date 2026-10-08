import { SignJWT, jwtVerify } from 'jose';

export const ROLES = ['CUSTOMER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const ISSUER = 'shopstream-gateway';
const AUDIENCE = 'shopstream';

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  user: AuthUser,
  secret: string,
  ttlSeconds = 60 * 60 * 24,
): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));
}

/** Verifies signature, issuer, audience and expiry. Returns null for any invalid token. */
export async function verifyAccessToken(token: string, secret: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    const role = payload.role;
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.name !== 'string' ||
      (role !== 'CUSTOMER' && role !== 'ADMIN')
    ) {
      return null;
    }
    return { id: payload.sub, email: payload.email, name: payload.name, role };
  } catch {
    return null;
  }
}

export function bearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;
  const [scheme, token] = value.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

export async function userFromAuthorization(
  header: string | string[] | undefined,
  secret: string,
): Promise<AuthUser | null> {
  const token = bearerToken(header);
  return token ? verifyAccessToken(token, secret) : null;
}
