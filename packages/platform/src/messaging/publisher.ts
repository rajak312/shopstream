import type { JetStreamClient } from '@nats-io/jetstream';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { headers as natsHeaders } from '@nats-io/transport-node';
import { eventSubject, parseEvent, type AnyEvent } from '@shopstream/contracts';
import type { ServiceMetrics } from '../metrics';
import type { FlowReporter } from './flow';
import { currentTraceHeaders, traceIdFromHeaders } from './trace-context';

const tracer = trace.getTracer('shopstream-messaging');

export interface EventPublisher {
  publish(event: AnyEvent, headers?: Record<string, string>): Promise<void>;
}

/**
 * Publishes validated events to JetStream. The event id doubles as the
 * Nats-Msg-Id so broker-side de-duplication makes relay retries safe.
 */
export class JetStreamEventPublisher implements EventPublisher {
  constructor(
    private readonly js: JetStreamClient,
    private readonly flow?: FlowReporter,
    private readonly metrics?: ServiceMetrics,
  ) {}

  async publish(event: AnyEvent, headers: Record<string, string> = {}): Promise<void> {
    parseEvent(event); // never put an invalid event on the wire
    await tracer.startActiveSpan(
      `${event.type} publish`,
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          'messaging.system': 'nats',
          'messaging.destination.name': eventSubject(event.type),
          'messaging.message.id': event.id,
          'shopstream.correlation_id': event.correlationId,
        },
      },
      async (span) => {
        try {
          await this.send(event, { ...headers, ...currentTraceHeaders() });
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  private async send(event: AnyEvent, headers: Record<string, string>): Promise<void> {
    const h = natsHeaders();
    for (const [k, v] of Object.entries(headers)) h.set(k, v);
    h.set('ce-type', event.type);
    h.set('ce-source', event.source);
    h.set('ce-id', event.id);
    h.set('correlation-id', event.correlationId);
    await this.js.publish(eventSubject(event.type), JSON.stringify(event), {
      msgID: event.id,
      headers: h,
    });
    this.metrics?.eventsPublished.inc({ type: event.type });
    const traceId = traceIdFromHeaders(headers);
    this.flow?.report({
      eventId: event.id,
      type: event.type,
      action: 'published',
      attempt: 0,
      correlationId: event.correlationId,
      ...(traceId ? { traceId } : {}),
    });
  }
}
