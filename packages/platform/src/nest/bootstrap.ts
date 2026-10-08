import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { parseOrigins } from '../config';
import type { ServiceMetrics } from '../metrics';
import { HealthRegistry } from './health';
import { NestPinoLogger } from './logger';

export interface StartOptions {
  module: unknown;
  logger: Logger;
  metrics: ServiceMetrics;
  port: number;
  host: string;
  corsOrigins: string;
  /** Register SIGTERM/SIGINT handlers. Disabled when several services share one process. */
  shutdownHooks: boolean;
  shutdownGraceMs: number;
}

const QUIET_PATHS = new Set(['/health', '/ready', '/metrics']);

export async function startNestService(opts: StartOptions): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(opts.module as never, {
    logger: new NestPinoLogger(opts.logger),
    bodyParser: true,
  });
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: '1mb' });
  app.use(
    pinoHttp({
      logger: opts.logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => QUIET_PATHS.has((req.url ?? '').split('?')[0] ?? '') },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug',
    }),
  );
  app.use(opts.metrics.httpMiddleware());
  app.enableCors({ origin: parseOrigins(opts.corsOrigins), credentials: true, maxAge: 600 });

  if (opts.shutdownHooks) installSignalHandlers(app, opts.logger, opts.shutdownGraceMs);
  await app.listen(opts.port, opts.host);
  opts.logger.info({ port: opts.port }, 'service listening');
  return app;
}

/**
 * Graceful shutdown: fail readiness first so the load balancer stops routing,
 * give it a moment, then close the app (Nest runs onApplicationShutdown hooks
 * which stop consumers, the outbox relay and DB pools). Hard-exit after a grace period.
 */
export function installSignalHandlers(app: INestApplication, logger: Logger, graceMs: number): void {
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down gracefully');
    const timer = setTimeout(() => {
      logger.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, graceMs);
    timer.unref();
    void gracefulClose(app, Math.min(2_000, graceMs / 4))
      .then(() => {
        logger.info('shutdown complete');
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'error during shutdown');
        process.exit(1);
      });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

export async function gracefulClose(app: INestApplication, drainDelayMs: number): Promise<void> {
  try {
    app.get(HealthRegistry).markShuttingDown();
  } catch {
    /* not registered */
  }
  if (drainDelayMs > 0) await new Promise((r) => setTimeout(r, drainDelayMs));
  await app.close();
}
