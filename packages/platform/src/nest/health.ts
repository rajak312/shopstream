import {
  Controller,
  Get,
  Header,
  HttpStatus,
  Inject,
  Injectable,
  Res,
  type DynamicModule,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Logger } from 'pino';
import type { ServiceMetrics } from '../metrics';
import { CONFIG, LOGGER, METRICS, SERVICE_INFO, type ServiceInfo } from './tokens';
import { Global, Module } from '@nestjs/common';

export interface ReadinessCheck {
  name: string;
  check(): Promise<void>;
}

/** Services register their dependency checks (database, broker, ...) here. */
@Injectable()
export class HealthRegistry {
  private readonly checks: ReadinessCheck[] = [];
  private shuttingDown = false;

  register(check: ReadinessCheck): void {
    this.checks.push(check);
  }

  /** Flip readiness to false at the start of graceful shutdown so load balancers drain us. */
  markShuttingDown(): void {
    this.shuttingDown = true;
  }

  async run(
    timeoutMs = 2_000,
  ): Promise<{ ok: boolean; checks: Record<string, { ok: boolean; error?: string; ms: number }> }> {
    const results: Record<string, { ok: boolean; error?: string; ms: number }> = {};
    await Promise.all(
      this.checks.map(async (c) => {
        const started = Date.now();
        try {
          await Promise.race([
            c.check(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
          ]);
          results[c.name] = { ok: true, ms: Date.now() - started };
        } catch (err) {
          results[c.name] = { ok: false, error: (err as Error).message, ms: Date.now() - started };
        }
      }),
    );
    if (this.shuttingDown) results.shutdown = { ok: false, error: 'shutting down', ms: 0 };
    return { ok: Object.values(results).every((r) => r.ok), checks: results };
  }
}

@Controller()
export class HealthController {
  constructor(
    private readonly registry: HealthRegistry,
    @Inject(SERVICE_INFO) private readonly info: ServiceInfo,
    @Inject(METRICS) private readonly metrics: ServiceMetrics,
  ) {}

  /** Liveness: the process is up and the event loop responds. No dependency checks. */
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: this.info.name,
      version: this.info.version,
      uptimeSeconds: Math.round((Date.now() - this.info.startedAt.getTime()) / 1000),
    };
  }

  /** Readiness: every dependency (DB, broker) answers. 503 removes the pod from load balancing. */
  @Get('ready')
  async ready(@Res() res: Response) {
    const result = await this.registry.run();
    res
      .status(result.ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json({ status: result.ok ? 'ready' : 'not_ready', service: this.info.name, checks: result.checks });
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metricsEndpoint() {
    return this.metrics.registry.metrics();
  }
}

export interface PlatformModuleOptions<C> {
  service: string;
  version?: string;
  config: C;
  logger: Logger;
  metrics: ServiceMetrics;
}

@Global()
@Module({})
export class PlatformModule {
  static forRoot<C>(opts: PlatformModuleOptions<C>): DynamicModule {
    return {
      module: PlatformModule,
      global: true,
      controllers: [HealthController],
      providers: [
        HealthRegistry,
        {
          provide: SERVICE_INFO,
          useValue: {
            name: opts.service,
            version: opts.version ?? process.env.APP_VERSION ?? 'dev',
            startedAt: new Date(),
          },
        },
        { provide: LOGGER, useValue: opts.logger },
        { provide: METRICS, useValue: opts.metrics },
        { provide: CONFIG, useValue: opts.config },
      ],
      exports: [HealthRegistry, SERVICE_INFO, LOGGER, METRICS, CONFIG],
    };
  }
}
