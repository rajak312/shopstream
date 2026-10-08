import { buildSubgraphSchema } from '@apollo/subgraph';
import { signAccessToken, type AuthUser } from '@shopstream/platform';
import { GraphQLError, parse, type GraphQLSchema } from 'graphql';
import { z } from 'zod';
import type { GatewayContext } from '../federation/context';
import { RateLimiter } from './rate-limiter';
import { EmailTakenError, toAuthUser, type UsersRepository } from './users';

/**
 * The identity subgraph runs *inside* the gateway process (LocalGraphQLDataSource):
 * authentication happens at the edge, and the issued JWT is then forwarded to
 * and re-verified by every other subgraph.
 */
export const identityTypeDefs = /* GraphQL */ `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key"])

  enum Role {
    CUSTOMER
    ADMIN
  }

  type User @key(fields: "id") {
    id: ID!
    email: String!
    name: String!
    role: Role!
  }

  type AuthPayload {
    token: String!
    expiresAt: String!
    user: User!
  }

  type Query {
    "The signed-in user, or null."
    me: User
    "Credentials of the public demo account (shown on the login page)."
    demoAccount: DemoAccount!
  }

  type DemoAccount {
    email: String!
    password: String!
  }

  type Mutation {
    register(email: String!, password: String!, name: String!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    "One-click sign-in as the seeded demo shopper."
    demoLogin: AuthPayload!
  }
`;

const registerSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  name: z.string().trim().min(1).max(80),
});

export interface IdentityOptions {
  users: UsersRepository;
  jwtSecret: string;
  ttlSeconds: number;
  demo: { email: string; password: string };
}

export function buildIdentitySchema(opts: IdentityOptions): GraphQLSchema {
  const limiter = new RateLimiter(10, 5 * 60_000);

  const issue = async (user: AuthUser) => ({
    token: await signAccessToken(user, opts.jwtSecret, opts.ttlSeconds),
    expiresAt: new Date(Date.now() + opts.ttlSeconds * 1000).toISOString(),
    user,
  });

  const guard = (ctx: GatewayContext, key: string) => {
    if (!limiter.take(`${ctx.ip}:${key}`)) {
      throw new GraphQLError('Too many attempts, please try again in a few minutes', {
        extensions: { code: 'RATE_LIMITED' },
      });
    }
  };

  return buildSubgraphSchema([
    {
      typeDefs: parse(identityTypeDefs),
      resolvers: {
        Query: {
          me: async (_: unknown, __: unknown, ctx: GatewayContext) => {
            if (!ctx.user) return null;
            const user = await opts.users.findById(ctx.user.id);
            return user ? toAuthUser(user) : null;
          },
          demoAccount: () => opts.demo,
        },
        Mutation: {
          register: async (_: unknown, args: unknown, ctx: GatewayContext) => {
            guard(ctx, 'register');
            const parsed = registerSchema.safeParse(args);
            if (!parsed.success) {
              throw new GraphQLError(parsed.error.issues[0]?.message ?? 'Invalid input', {
                extensions: { code: 'BAD_USER_INPUT' },
              });
            }
            try {
              const user = await opts.users.register(
                parsed.data.email,
                parsed.data.password,
                parsed.data.name,
              );
              return issue(toAuthUser(user));
            } catch (err) {
              if (err instanceof EmailTakenError) {
                throw new GraphQLError('An account with this email already exists', {
                  extensions: { code: 'BAD_USER_INPUT' },
                });
              }
              throw err;
            }
          },
          login: async (_: unknown, args: { email: string; password: string }, ctx: GatewayContext) => {
            guard(ctx, `login:${args.email.toLowerCase()}`);
            const user = await opts.users.authenticate(args.email, args.password);
            if (!user) {
              throw new GraphQLError('Invalid email or password', {
                extensions: { code: 'UNAUTHENTICATED' },
              });
            }
            return issue(toAuthUser(user));
          },
          demoLogin: async (_: unknown, __: unknown, ctx: GatewayContext) => {
            guard(ctx, 'demo');
            const user = await opts.users.authenticate(opts.demo.email, opts.demo.password);
            if (!user)
              throw new GraphQLError('Demo account unavailable', {
                extensions: { code: 'INTERNAL_SERVER_ERROR' },
              });
            return issue(toAuthUser(user));
          },
        },
        User: {
          __resolveReference: async (ref: { id: string }) => {
            const user = await opts.users.findById(ref.id);
            return user ? toAuthUser(user) : null;
          },
        },
      },
    },
  ]);
}
