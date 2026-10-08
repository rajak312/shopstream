import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createLogger,
  Messaging,
  OutboxRelay,
  ServiceMetrics,
  startNestService,
  type Env,
} from '@shopstream/platform';
import { OrdersModule } from './app.module';
import { CartService } from './cart/cart.service';
import { loadOrdersConfig } from './config';
import { PrismaEventStore } from './infra/outbox.store';
import { createPrisma } from './infra/prisma';
import { OrdersService } from './orders/orders.service';

export { transition, type OrderState, type SagaInput } from './domain/order-state-machine';

export async function startOrders(
  env: Env = process.env,
  opts: { shutdownHooks?: boolean; defaultMetrics?: boolean } = {},
): Promise<{ app: INestApplication; port: number }> {
  const config = loadOrdersConfig(env);
  const logger = createLogger('orders', config.LOG_LEVEL);
  const metrics = new ServiceMetrics('orders', { defaultMetrics: opts.defaultMetrics ?? true });

  const prisma = createPrisma(config.DATABASE_URL, config.DB_POOL_SIZE);
  await waitForPostgres(prisma, logger);
  const store = new PrismaEventStore(prisma);

  const messaging = await Messaging.connect({
    url: config.NATS_URL,
    service: 'orders',
    logger,
    metrics,
    streams: {
      storage: config.NATS_STREAM_STORAGE,
      replicas: config.NATS_STREAM_REPLICAS,
      maxMb: config.NATS_STREAM_MAX_MB,
    },
  });
  const relay = new OutboxRelay(
    store,
    messaging.publisher,
    logger.child({ component: 'outbox' }),
    {},
    metrics,
  );
  relay.start();

  const orders = new OrdersService(prisma, store, logger.child({ component: 'orders' }), () =>
    relay.trigger(),
  );
  const carts = new CartService(prisma);

  await messaging.consume({
    durable: 'orders-product-replica',
    types: ['catalog.product.upserted'],
    handler: (event) => orders.upsertSnapshot(event),
  });
  await messaging.consume({
    durable: 'orders-saga',
    types: [
      'payment.succeeded',
      'payment.failed',
      'payment.refunded',
      'inventory.reserved',
      'inventory.rejected',
      'inventory.released',
      'inventory.committed',
    ],
    handler: (event) => orders.handleSagaEvent(event),
  });

  // Background loops: simulated warehouse + outbox housekeeping.
  let stopped = false;
  const loops: Promise<void>[] = [];
  if (config.FULFILLMENT_ENABLED) {
    loops.push(
      (async () => {
        while (!stopped) {
          try {
            await orders.fulfillmentTick(
              config.FULFILLMENT_SHIP_AFTER_MS,
              config.FULFILLMENT_DELIVER_AFTER_MS,
            );
          } catch (err) {
            logger.warn({ err }, 'fulfillment tick failed');
          }
          await new Promise((r) => setTimeout(r, 1_000));
        }
      })(),
    );
  }
  const purgeTimer = setInterval(() => void store.purgePublished().catch(() => undefined), 3_600_000);
  purgeTimer.unref();

  const app = await startNestService({
    module: OrdersModule.forRoot({
      config,
      logger,
      metrics,
      prisma,
      messaging,
      relay,
      orders,
      carts,
      stopBackground: async () => {
        stopped = true;
        clearInterval(purgeTimer);
        await Promise.all(loops);
      },
    }),
    logger,
    metrics,
    port: config.PORT,
    host: config.HOST,
    corsOrigins: config.CORS_ORIGINS,
    shutdownHooks: opts.shutdownHooks ?? true,
    shutdownGraceMs: config.SHUTDOWN_GRACE_MS,
  });
  return { app, port: config.PORT };
}

async function waitForPostgres(
  prisma: ReturnType<typeof createPrisma>,
  logger: ReturnType<typeof createLogger>,
) {
  const deadline = Date.now() + 60_000;
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.info('connected to PostgreSQL');
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      logger.warn({ attempt, err: (err as Error).message }, 'PostgreSQL not reachable yet, retrying');
      await new Promise((r) => setTimeout(r, Math.min(500 * attempt, 3_000)));
    }
  }
}
