import { baseEnvSchema, loadConfig, type Env } from '@shopstream/platform';
import { z } from 'zod';

export const paymentsEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().default(4003),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/?replicaSet=rs0'),
  PAYMENTS_DB: z.string().default('shopstream_payments'),
  /** Artificial processor latency so the saga is visible in the UI. */
  PAYMENT_LATENCY_MS: z.coerce.number().int().nonnegative().default(700),
});

export type PaymentsConfig = z.infer<typeof paymentsEnvSchema>;
export const loadPaymentsConfig = (env?: Env): PaymentsConfig => loadConfig(paymentsEnvSchema, env);
