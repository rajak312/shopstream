import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';
import { userFromAuthorization, type AuthUser } from '../auth';

export interface GraphQLContext {
  req: Request;
  user: AuthUser | null;
}

/**
 * Subgraphs re-verify the JWT the gateway forwards (zero-trust between
 * services): a request that bypasses the gateway gets no identity.
 */
export function subgraphContext(jwtSecret: string) {
  return async ({ req }: { req: Request }): Promise<GraphQLContext> => ({
    req,
    user: await userFromAuthorization(req.headers.authorization, jwtSecret),
  });
}

export function requireUser(ctx: GraphQLContext): AuthUser {
  if (!ctx.user) throw unauthenticated();
  return ctx.user;
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const ctx = GqlExecutionContext.create(context).getContext<GraphQLContext>();
  return requireUser(ctx);
});

export const OptionalUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return GqlExecutionContext.create(context).getContext<GraphQLContext>().user;
});

export function unauthenticated(message = 'You must be signed in'): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } } });
}

export function forbidden(message = 'Forbidden'): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'FORBIDDEN' } });
}

export function badInput(message: string, details?: Record<string, unknown>): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT', ...details } });
}

export function notFound(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'NOT_FOUND' } });
}

/** ISO-8601 DateTime scalar shared by every subgraph (identical definition is required by federation). */
export const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'ISO-8601 timestamp, e.g. 2026-01-31T12:00:00.000Z',
  serialize(value) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' || typeof value === 'number') return new Date(value).toISOString();
    throw new TypeError('DateTime cannot serialize this value');
  },
  parseValue(value) {
    if (typeof value !== 'string') throw new TypeError('DateTime must be a string');
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new TypeError('Invalid DateTime');
    return d;
  },
  parseLiteral(ast) {
    if (ast.kind !== Kind.STRING) throw new TypeError('DateTime must be a string');
    return new Date(ast.value);
  },
});

/** Opaque cursor helpers for Relay-style connections. */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T>(cursor: string): T {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw badInput('Invalid cursor');
  }
}
