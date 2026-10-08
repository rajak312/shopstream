import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  connectMongo,
  createLogger,
  Messaging,
  MongoEventStore,
  OutboxRelay,
  ServiceMetrics,
  startNestService,
  type Env,
} from '@shopstream/platform';
import { PaymentsModule } from './app.module';
import { loadPaymentsConfig } from './config';
import { PaymentsService } from './payments.service';

export async function startPayments(
  env: Env = process.env,
  opts: { shutdownHooks?: boolean; defaultMetrics?: boolean } = {},
): Promise<{ app: INestApplication; port: number }> {
  const config = loadPaymentsConfig(env);
  const logger = createLogger('payments', config.LOG_LEVEL);
  const metrics = new ServiceMetrics('payments', { defaultMetrics: opts.defaultMetrics ?? true });

  const mongo = await connectMongo(config.MONGODB_URI, config.PAYMENTS_DB, logger);
  const store = new MongoEventStore(mongo);
  await store.init();

  const messaging = await Messaging.connect({
    url: config.NATS_URL,
    service: 'payments',
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

  const payments = new PaymentsService(
    mongo,
    store,
    logger.child({ component: 'processor' }),
    config.PAYMENT_LATENCY_MS,
    () => relay.trigger(),
  );
  await payments.init();
  await messaging.consume({
    durable: 'payments-processor',
    types: ['order.created', 'order.cancelled'],
    handler: (event, ctx) => payments.handle(event, ctx.attempt),
  });

  const app = await startNestService({
    module: PaymentsModule.forRoot({ config, logger, metrics, mongo, messaging, relay, payments }),
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
