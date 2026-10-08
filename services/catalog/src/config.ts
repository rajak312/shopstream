import { baseEnvSchema, loadConfig, type Env } from '@shopstream/platform';
import { z } from 'zod';

export const catalogEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().default(4001),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/?replicaSet=rs0'),
  CATALOG_DB: z.string().default('shopstream_catalog'),
  SEED_ON_START: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type CatalogConfig = z.infer<typeof catalogEnvSchema>;
export const loadCatalogConfig = (env?: Env): CatalogConfig => loadConfig(catalogEnvSchema, env);
