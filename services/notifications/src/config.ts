import { baseEnvSchema, loadConfig, type Env } from '@shopstream/platform';
import { z } from 'zod';

export const notificationsEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().default(4004),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/?replicaSet=rs0'),
  NOTIFICATIONS_DB: z.string().default('shopstream_notifications'),
  SSE_HEARTBEAT_MS: z.coerce.number().int().positive().default(15_000),
});

export type NotificationsConfig = z.infer<typeof notificationsEnvSchema>;
export const loadNotificationsConfig = (env?: Env): NotificationsConfig =>
  loadConfig(notificationsEnvSchema, env);
