import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { EVENT_TYPES } from '@shopstream/contracts';
import {
  connectMongo,
  createLogger,
  Messaging,
  MongoEventStore,
  ServiceMetrics,
  startNestService,
  type Env,
} from '@shopstream/platform';
import { NotificationsModule } from './app.module';
import { loadNotificationsConfig } from './config';
import { NotificationsService } from './notifications.service';
import { StreamHub } from './stream/stream.hub';

export { describeEvent } from './describe';

export async function startNotifications(
  env: Env = process.env,
  opts: { shutdownHooks?: boolean; defaultMetrics?: boolean } = {},
): Promise<{ app: INestApplication; port: number }> {
  const config = loadNotificationsConfig(env);
  const logger = createLogger('notifications', config.LOG_LEVEL);
  const metrics = new ServiceMetrics('notifications', { defaultMetrics: opts.defaultMetrics ?? true });

  const mongo = await connectMongo(config.MONGODB_URI, config.NOTIFICATIONS_DB, logger);
  const store = new MongoEventStore(mongo);
  await store.init();

  const messaging = await Messaging.connect({
    url: config.NATS_URL,
    service: 'notifications',
    logger,
    metrics,
    streams: {
      storage: config.NATS_STREAM_STORAGE,
      replicas: config.NATS_STREAM_REPLICAS,
      maxMb: config.NATS_STREAM_MAX_MB,
    },
  });
  const notifications = new NotificationsService(
    mongo,
    store,
    messaging.handles.nc,
    logger.child({ component: 'feed' }),
  );
  await notifications.init();
  const hub = new StreamHub(
    messaging.handles.nc,
    logger.child({ component: 'sse' }),
    config.SSE_HEARTBEAT_MS,
  );
  hub.start();

  await messaging.consume({
    durable: 'notifications-feed',
    types: EVENT_TYPES.filter((t) => t !== 'catalog.product.upserted'),
    handler: (event) => notifications.handle(event),
  });

  const app = await startNestService({
    module: NotificationsModule.forRoot({ config, logger, metrics, mongo, messaging, notifications, hub }),
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
