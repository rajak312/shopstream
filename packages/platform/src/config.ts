import { z } from 'zod';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Env fragments shared by every service. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HOST: z.string().default('0.0.0.0'),
  NATS_URL: z.string().default('nats://localhost:4222'),
  /** JetStream storage for streams the service creates: "file" in prod, "memory" works for tests. */
  NATS_STREAM_STORAGE: z.enum(['file', 'memory']).default('file'),
  NATS_STREAM_REPLICAS: z.coerce.number().int().min(1).max(5).default(1),
  /** Size cap of the event stream; the dead-letter stream gets a quarter of it. */
  NATS_STREAM_MAX_MB: z.coerce.number().int().min(8).default(256),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  CORS_ORIGINS: z.string().default('http://localhost:3700'),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(10_000),
});

export type BaseConfig = z.infer<typeof baseEnvSchema>;

export type Env = Record<string, string | undefined>;

/** Parses env vars with a zod schema and fails fast with a readable message listing every problem. */
export function loadConfig<S extends z.ZodType>(schema: S, env: Env = process.env): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid configuration:\n${problems}`);
  }
  return result.data;
}

export function parseOrigins(value: string): string[] | true {
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes('*') ? true : list;
}
