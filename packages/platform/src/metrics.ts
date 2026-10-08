import type { NextFunction, Request, Response } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * One registry per service instance (several services can share a process in
 * the all-in-one demo). Exposes RED metrics for HTTP/GraphQL and event handling.
 */
export class ServiceMetrics {
  readonly registry = new Registry();
  readonly httpDuration: Histogram<'method' | 'route' | 'status_code'>;
  readonly eventsConsumed: Counter<'type' | 'consumer' | 'outcome'>;
  readonly eventHandlingDuration: Histogram<'type' | 'consumer'>;
  readonly eventsPublished: Counter<'type'>;
  readonly outboxPending: Gauge;

  constructor(
    readonly service: string,
    options: { defaultMetrics?: boolean } = {},
  ) {
    this.registry.setDefaultLabels({ service });
    if (options.defaultMetrics ?? true) collectDefaultMetrics({ register: this.registry });
    this.httpDuration = new Histogram({
      name: 'http_server_request_duration_seconds',
      help: 'Duration of HTTP requests (GraphQL operations are reported with route=/graphql).',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.eventsConsumed = new Counter({
      name: 'shopstream_events_consumed_total',
      help: 'Events handled by durable consumers, by outcome (processed, duplicate, retried, dead_lettered).',
      labelNames: ['type', 'consumer', 'outcome'],
      registers: [this.registry],
    });
    this.eventHandlingDuration = new Histogram({
      name: 'shopstream_event_handling_duration_seconds',
      help: 'Time spent handling one event delivery.',
      labelNames: ['type', 'consumer'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      registers: [this.registry],
    });
    this.eventsPublished = new Counter({
      name: 'shopstream_events_published_total',
      help: 'Events published to JetStream by the outbox relay.',
      labelNames: ['type'],
      registers: [this.registry],
    });
    this.outboxPending = new Gauge({
      name: 'shopstream_outbox_pending',
      help: 'Outbox rows not yet published (observed at the last relay tick).',
      registers: [this.registry],
    });
  }

  httpMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const path = req.path;
      if (path === '/metrics' || path === '/health' || path === '/ready') return next();
      const end = this.httpDuration.startTimer({ method: req.method });
      res.on('finish', () => {
        const route = path.startsWith('/graphql') ? '/graphql' : normalizeRoute(path);
        end({ route, status_code: String(res.statusCode) });
      });
      next();
    };
  }
}

function normalizeRoute(path: string): string {
  return path
    .split('/')
    .map((seg) => (/^[0-9a-f-]{8,}$/i.test(seg) || /^\d+$/.test(seg) ? ':id' : seg))
    .join('/');
}
