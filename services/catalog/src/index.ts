import type { INestApplication } from '@nestjs/common';
import {
  createLogger,
  connectMongo,
  Messaging,
  MongoEventStore,
  OutboxRelay,
  ServiceMetrics,
  startNestService,
  type Env,
} from '@shopstream/platform';
import 'reflect-metadata';
import { CatalogModule } from './app.module';
import { loadCatalogConfig } from './config';
import { InventoryService } from './inventory/inventory.service';
import { createModels } from './models';
import { ProductService } from './products/product.service';
import { seedCatalog } from './seed/seeder';

export { SEED_PRODUCTS, SEED_CATEGORIES } from './seed/data';
export { productId } from './seed/seeder';

export interface StartedService {
  app: INestApplication;
  port: number;
}

export async function startCatalog(
  env: Env = process.env,
  opts: { shutdownHooks?: boolean; defaultMetrics?: boolean } = {},
): Promise<StartedService> {
  const config = loadCatalogConfig(env);
  const logger = createLogger('catalog', config.LOG_LEVEL);
  const metrics = new ServiceMetrics('catalog', { defaultMetrics: opts.defaultMetrics ?? true });

  const mongo = await connectMongo(config.MONGODB_URI, config.CATALOG_DB, logger);
  const models = await createModels(mongo);
  const store = new MongoEventStore(mongo);
  await store.init();

  const messaging = await Messaging.connect({
    url: config.NATS_URL,
    service: 'catalog',
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

  if (config.SEED_ON_START) {
    await seedCatalog(models, store, logger);
    relay.trigger();
  }

  const inventory = new InventoryService(models, store, logger.child({ component: 'inventory' }), () =>
    relay.trigger(),
  );
  await messaging.consume({
    durable: 'catalog-inventory',
    types: ['order.created', 'order.cancelled', 'order.shipped'],
    handler: (event) => inventory.handle(event),
  });

  const app = await startNestService({
    module: CatalogModule.forRoot({
      config,
      logger,
      metrics,
      mongo,
      messaging,
      relay,
      products: new ProductService(models),
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
