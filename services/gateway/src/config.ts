import { baseEnvSchema, loadConfig, type Env } from '@shopstream/platform';
import { z } from 'zod';

export const gatewayEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/?replicaSet=rs0'),
  IDENTITY_DB: z.string().default('shopstream_identity'),
  CATALOG_URL: z.url().default('http://localhost:4001/graphql'),
  ORDERS_URL: z.url().default('http://localhost:4002/graphql'),
  PAYMENTS_URL: z.url().default('http://localhost:4003/graphql'),
  NOTIFICATIONS_URL: z.url().default('http://localhost:4004/graphql'),
  /** Re-compose the supergraph periodically to pick up subgraph schema changes (0 = off). */
  SUPERGRAPH_POLL_MS: z.coerce.number().int().nonnegative().default(30_000),
  MAX_QUERY_DEPTH: z.coerce.number().int().min(3).max(50).default(12),
  JWT_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24),
  DEMO_USER_EMAIL: z.email().default('demo@shopstream.dev'),
  DEMO_USER_PASSWORD: z.string().min(8).default('demo-password'),
  DEMO_USER_NAME: z.string().default('Demo Shopper'),
});

export type GatewayConfig = z.infer<typeof gatewayEnvSchema>;
export const loadGatewayConfig = (env?: Env): GatewayConfig => loadConfig(gatewayEnvSchema, env);
