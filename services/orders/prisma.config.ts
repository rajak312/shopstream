import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 config. Migrations use DIRECT_URL when set (Neon: the non-pooled
 * endpoint) and fall back to DATABASE_URL; the app itself always uses
 * DATABASE_URL through the pg driver adapter.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      'postgresql://shopstream:shopstream@localhost:4710/shopstream_orders',
  },
});
