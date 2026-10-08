import type { AuthUser } from '@shopstream/platform';
import { userFromAuthorization } from '@shopstream/platform';
import type { Request } from 'express';

export interface GatewayContext {
  user: AuthUser | null;
  /** Raw bearer header, forwarded to subgraphs which re-verify it. */
  authorization?: string;
  requestId?: string;
  ip: string;
}

export function gatewayContext(jwtSecret: string) {
  return async ({ req }: { req: Request }): Promise<GatewayContext> => {
    const authorization = req.headers.authorization;
    const user = await userFromAuthorization(authorization, jwtSecret);
    return {
      user,
      // Only forward a token that verified; garbage never reaches the subgraphs.
      ...(user && authorization ? { authorization } : {}),
      requestId: (req as Request & { id?: string }).id ?? (req.headers['x-request-id'] as string | undefined),
      ip: req.ip ?? 'unknown',
    };
  };
}
