import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        // Fast, hermetic unit tests run straight from TypeScript sources.
        resolve: {
          alias: {
            '@shopstream/contracts': src('./packages/contracts/src/index.ts'),
            '@shopstream/platform': src('./packages/platform/src/index.ts'),
          },
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'services/*/src/**/*.test.ts'],
        },
      },
      {
        // Full-system tests: real MongoDB, PostgreSQL and NATS via Testcontainers,
        // all services booted from the compiled build (run `npm run build:services` first).
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['tests/e2e/**/*.e2e.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
