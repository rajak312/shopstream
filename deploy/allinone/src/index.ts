import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { startCatalog } from '@shopstream/catalog';
import { startGateway } from '@shopstream/gateway';
import { startNotifications } from '@shopstream/notifications';
import { startOrders } from '@shopstream/orders';
import { startPayments } from '@shopstream/payments';
import { createLogger, gracefulClose, type Env } from '@shopstream/platform';
import { startEmbeddedNats, type EmbeddedNats } from './nats-server';

export interface AllInOne {
  gatewayUrl: string;
  stop(): Promise<void>;
}

/**
 * Boots every ShopStream service inside ONE Node.js process (plus an optional
 * embedded nats-server). Services keep their own Nest app, port, config,
 * metrics registry and connections; they just share a V8 heap, which is what
 * lets the whole system fit in a 512 MB free-tier container.
 */
export async function startAllInOne(env: Env = process.env): Promise<AllInOne> {
  const logger = createLogger('allinone', (env.LOG_LEVEL as 'info' | undefined) ?? 'info');
  const internalHost = '127.0.0.1';
  const base = Number(env.INTERNAL_PORT_BASE ?? 4100);
  const ports = { catalog: base + 1, orders: base + 2, payments: base + 3, notifications: base + 4 };
  const gatewayPort = Number(env.PORT ?? 4000);

  let nats: EmbeddedNats | undefined;
  if (env.NATS_EMBEDDED !== 'false') {
    nats = await startEmbeddedNats({
      binary: env.NATS_SERVER_BIN ?? 'nats-server',
      dataDir: env.NATS_DATA_DIR ?? '/tmp/nats',
      port: Number(env.NATS_PORT ?? 4222),
      logger,
    });
  }
  const natsUrl = nats?.url ?? env.NATS_URL ?? 'nats://127.0.0.1:4222';

  if (env.RUN_MIGRATIONS !== 'false') runMigrations(env, logger);

  const common: Env = { ...env, NATS_URL: natsUrl, HOST: internalHost };
  const opts = { shutdownHooks: false };
  const apps: { name: string; app: INestApplication }[] = [];
  try {
    const started = await Promise.all([
      startCatalog({ ...common, PORT: String(ports.catalog) }, { ...opts, defaultMetrics: true }),
      startOrders(
        { ...common, PORT: String(ports.orders), DB_POOL_SIZE: env.DB_POOL_SIZE ?? '5' },
        { ...opts, defaultMetrics: false },
      ),
      startPayments({ ...common, PORT: String(ports.payments) }, { ...opts, defaultMetrics: false }),
      startNotifications(
        { ...common, PORT: String(ports.notifications) },
        { ...opts, defaultMetrics: false },
      ),
    ]);
    apps.push(
      { name: 'catalog', app: started[0].app },
      { name: 'orders', app: started[1].app },
      { name: 'payments', app: started[2].app },
      { name: 'notifications', app: started[3].app },
    );
    const gateway = await startGateway(
      {
        ...common,
        HOST: env.HOST ?? '0.0.0.0',
        PORT: String(gatewayPort),
        CATALOG_URL: `http://${internalHost}:${ports.catalog}/graphql`,
        ORDERS_URL: `http://${internalHost}:${ports.orders}/graphql`,
        PAYMENTS_URL: `http://${internalHost}:${ports.payments}/graphql`,
        NOTIFICATIONS_URL: `http://${internalHost}:${ports.notifications}/graphql`,
      },
      { ...opts, defaultMetrics: false },
    );
    apps.unshift({ name: 'gateway', app: gateway.app });
  } catch (err) {
    await Promise.allSettled(apps.map((a) => a.app.close()));
    await nats?.stop();
    throw err;
  }
  logger.info({ gatewayPort }, 'all ShopStream services are up');

  return {
    gatewayUrl: `http://127.0.0.1:${gatewayPort}/graphql`,
    stop: async () => {
      // Edge first (stop taking traffic), then the backends, then the broker.
      const [edge, ...rest] = apps;
      if (edge) await gracefulClose(edge.app, 0);
      await Promise.allSettled(rest.map((a) => gracefulClose(a.app, 0)));
      await nats?.stop();
      logger.info('all services stopped');
    },
  };
}

function runMigrations(env: Env, logger: ReturnType<typeof createLogger>): void {
  const ordersDir = dirname(require.resolve('@shopstream/orders/package.json'));
  const prismaCli = join(
    dirname(require.resolve('prisma/package.json', { paths: [ordersDir] })),
    'build',
    'index.js',
  );
  logger.info('applying database migrations (prisma migrate deploy)');
  const res = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: ordersDir,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (res.status !== 0) throw new Error(`prisma migrate deploy failed with exit code ${res.status}`);
}
