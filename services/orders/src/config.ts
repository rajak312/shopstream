import { baseEnvSchema, loadConfig, type Env } from '@shopstream/platform';
import { z } from 'zod';

export const ordersEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().default(4002),
  DATABASE_URL: z.string().default('postgresql://shopstream:shopstream@localhost:4710/shopstream_orders'),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),
  /** Simulated warehouse timings (ms). */
  FULFILLMENT_SHIP_AFTER_MS: z.coerce.number().int().nonnegative().default(4_000),
  FULFILLMENT_DELIVER_AFTER_MS: z.coerce.number().int().nonnegative().default(8_000),
  FULFILLMENT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type OrdersConfig = z.infer<typeof ordersEnvSchema>;
export const loadOrdersConfig = (env?: Env): OrdersConfig => loadConfig(ordersEnvSchema, env);
