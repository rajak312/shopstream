import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { connectMongo, createLogger, ServiceMetrics, startNestService, type Env } from '@shopstream/platform';
import { GatewayModule } from './app.module';
import { loadGatewayConfig } from './config';
import { buildIdentitySchema } from './identity/identity.subgraph';
import { UsersRepository } from './identity/users';

export { composeSupergraph } from './federation/supergraph';
export { subgraphList } from './app.module';
export { identityTypeDefs } from './identity/identity.subgraph';

export async function startGateway(
  env: Env = process.env,
  opts: { shutdownHooks?: boolean; defaultMetrics?: boolean } = {},
): Promise<{ app: INestApplication; port: number }> {
  const config = loadGatewayConfig(env);
  const logger = createLogger('gateway', config.LOG_LEVEL);
  const metrics = new ServiceMetrics('gateway', { defaultMetrics: opts.defaultMetrics ?? true });

  const mongo = await connectMongo(config.MONGODB_URI, config.IDENTITY_DB, logger);
  const users = new UsersRepository(mongo);
  await users.init();
  await users.ensureDemoUser(
    config.DEMO_USER_EMAIL,
    config.DEMO_USER_PASSWORD,
    config.DEMO_USER_NAME,
    logger,
  );

  const identitySchema = buildIdentitySchema({
    users,
    jwtSecret: config.JWT_SECRET,
    ttlSeconds: config.JWT_TTL_SECONDS,
    demo: { email: config.DEMO_USER_EMAIL, password: config.DEMO_USER_PASSWORD },
  });

  const app = await startNestService({
    module: GatewayModule.forRoot({ config, logger, metrics, mongo, identitySchema }),
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
