import {
  AckPolicy,
  DeliverPolicy,
  JetStreamApiError,
  type ConsumerConfig,
  type ConsumerMessages,
  type JetStreamClient,
  type JetStreamManager,
} from '@nats-io/jetstream';
import { headers as natsHeaders, nanos, type MsgHdrs } from '@nats-io/transport-node';
import { SpanKind, SpanStatusCode, context, trace } from '@opentelemetry/api';
import {
  EVENTS_STREAM,
  EventValidationError,
  dlqSubject,
  eventSubject,
  parseEvent,
  typeFromSubject,
  type AnyEvent,
  type EventType,
  type ServiceName,
} from '@shopstream/contracts';
import type { Logger } from '../logger';
import type { ServiceMetrics } from '../metrics';
import type { FlowReporter } from './flow';
import { contextFromHeaders } from './trace-context';

export type HandlerResult = 'processed' | 'duplicate';

export interface DeliveryContext {
  attempt: number;
  subject: string;
}

export type EventHandler = (event: AnyEvent, ctx: DeliveryContext) => Promise<HandlerResult>;

export interface RetryPolicy {
  /** Total deliveries (first attempt included) before the message is dead-lettered. */
  maxDeliver: number;
  /** Redelivery delay per failed attempt; the last value is reused. */
  backoffMs: number[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxDeliver: 5,
  backoffMs: [250, 1_000, 3_000, 10_000],
};

export type FailureDecision = { kind: 'retry'; delayMs: number } | { kind: 'dead_letter'; reason: string };

/** Pure retry/dead-letter decision, unit-tested in isolation. */
export function decideOnFailure(error: unknown, attempt: number, policy: RetryPolicy): FailureDecision {
  if (error instanceof EventValidationError) {
    return { kind: 'dead_letter', reason: `poison message: ${error.message}` };
  }
  if (error instanceof NonRetryableError) {
    return { kind: 'dead_letter', reason: error.message };
  }
  if (attempt >= policy.maxDeliver) {
    return {
      kind: 'dead_letter',
      reason: `max deliveries (${policy.maxDeliver}) exhausted: ${(error as Error)?.message ?? String(error)}`,
    };
  }
  const delayMs =
    policy.backoffMs[Math.min(attempt - 1, policy.backoffMs.length - 1)] ??
    DEFAULT_RETRY_POLICY.backoffMs[0]!;
  return { kind: 'retry', delayMs };
}

/** Throw from a handler to skip retries and dead-letter immediately. */
export class NonRetryableError extends Error {
  override readonly name = 'NonRetryableError';
}

/** The subset of a JetStream message the processing logic needs (keeps it testable). */
export interface Delivery {
  subject: string;
  data: Uint8Array;
  headers?: MsgHdrs;
  attempt: number;
  ack(): void;
  nak(delayMs?: number): void;
  term(reason?: string): void;
}

export interface DeadLetterSink {
  deadLetter(delivery: Delivery, consumer: ServiceName, reason: string): Promise<void>;
}

export interface ProcessDeps {
  service: ServiceName;
  durable: string;
  handler: EventHandler;
  policy: RetryPolicy;
  logger: Logger;
  deadLetters: DeadLetterSink;
  flow?: FlowReporter;
  metrics?: ServiceMetrics;
}

const tracer = trace.getTracer('shopstream-messaging');

export async function processDelivery(delivery: Delivery, deps: ProcessDeps): Promise<void> {
  const parent = contextFromHeaders(delivery.headers);
  const typeHint = typeFromSubject(delivery.subject);
  const started = performance.now();
  await context.with(parent, () =>
    tracer.startActiveSpan(
      `${typeHint} process`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'nats',
          'messaging.destination.name': delivery.subject,
          'messaging.consumer.group.name': deps.durable,
          'messaging.message.delivery_attempt': delivery.attempt,
        },
      },
      async (span) => {
        let event: AnyEvent | undefined;
        const traceId = span.spanContext().traceId;
        const base = (e: { id: string; correlationId: string } | undefined) => ({
          eventId: e?.id ?? 'unknown',
          type: typeHint,
          attempt: delivery.attempt,
          correlationId: e?.correlationId ?? 'unknown',
          traceId,
        });
        try {
          event = parseEvent(JSON.parse(new TextDecoder().decode(delivery.data)));
          span.setAttribute('messaging.message.id', event.id);
          span.setAttribute('shopstream.correlation_id', event.correlationId);
          const result = await deps.handler(event, {
            attempt: delivery.attempt,
            subject: delivery.subject,
          });
          delivery.ack();
          const durationMs = performance.now() - started;
          deps.metrics?.eventsConsumed.inc({ type: event.type, consumer: deps.durable, outcome: result });
          deps.metrics?.eventHandlingDuration.observe(
            { type: event.type, consumer: deps.durable },
            durationMs / 1000,
          );
          deps.flow?.report({
            ...base(event),
            action: result === 'duplicate' ? 'duplicate' : 'consumed',
            durationMs: Math.round(durationMs),
          });
          deps.logger.debug(
            { eventId: event.id, type: event.type, attempt: delivery.attempt, result },
            'event handled',
          );
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (err) {
          const decision = decideOnFailure(err, delivery.attempt, deps.policy);
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
          if (decision.kind === 'retry') {
            delivery.nak(decision.delayMs);
            deps.metrics?.eventsConsumed.inc({ type: typeHint, consumer: deps.durable, outcome: 'retried' });
            deps.flow?.report({ ...base(event), action: 'retried', error: (err as Error).message });
            deps.logger.warn(
              {
                err,
                eventId: event?.id,
                type: typeHint,
                attempt: delivery.attempt,
                delayMs: decision.delayMs,
              },
              'event handling failed, will retry',
            );
          } else {
            try {
              await deps.deadLetters.deadLetter(delivery, deps.service, decision.reason);
              delivery.term(decision.reason);
              deps.metrics?.eventsConsumed.inc({
                type: typeHint,
                consumer: deps.durable,
                outcome: 'dead_lettered',
              });
              deps.flow?.report({ ...base(event), action: 'dead_lettered', error: decision.reason });
              deps.logger.error(
                { err, eventId: event?.id, type: typeHint, attempt: delivery.attempt },
                'event dead-lettered',
              );
            } catch (dlqErr) {
              delivery.nak(DEFAULT_RETRY_POLICY.backoffMs.at(-1));
              deps.logger.error({ err: dlqErr }, 'failed to dead-letter event, will retry');
            }
          }
        } finally {
          span.end();
        }
      },
    ),
  );
}

export class JetStreamDeadLetterSink implements DeadLetterSink {
  constructor(private readonly js: JetStreamClient) {}

  async deadLetter(delivery: Delivery, consumer: ServiceName, reason: string): Promise<void> {
    const h = natsHeaders();
    if (delivery.headers) {
      for (const key of delivery.headers.keys()) h.set(key, delivery.headers.get(key));
    }
    h.set('x-dlq-reason', reason.slice(0, 500));
    h.set('x-dlq-consumer', consumer);
    h.set('x-dlq-attempts', String(delivery.attempt));
    h.set('x-dlq-original-subject', delivery.subject);
    await this.js.publish(dlqSubject(consumer, typeFromSubject(delivery.subject)), delivery.data, {
      headers: h,
    });
  }
}

export interface DurableConsumerOptions {
  service: ServiceName;
  /** Durable name: one per (service, purpose). Survives restarts and is shared by replicas. */
  durable: string;
  types: EventType[];
  handler: EventHandler;
  policy?: RetryPolicy;
  ackWaitMs?: number;
}

/**
 * A JetStream pull consumer with explicit acks, bounded redelivery with backoff
 * and a dead-letter subject. Replicas share the durable, so work is load-balanced.
 */
export class DurableConsumer {
  private messages?: ConsumerMessages;
  private loop?: Promise<void>;
  private readonly policy: RetryPolicy;

  constructor(
    private readonly js: JetStreamClient,
    private readonly jsm: JetStreamManager,
    private readonly opts: DurableConsumerOptions,
    private readonly logger: Logger,
    private readonly flow?: FlowReporter,
    private readonly metrics?: ServiceMetrics,
  ) {
    this.policy = opts.policy ?? DEFAULT_RETRY_POLICY;
  }

  async start(): Promise<void> {
    const config: Partial<ConsumerConfig> = {
      durable_name: this.opts.durable,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      filter_subjects: this.opts.types.map(eventSubject),
      max_deliver: this.policy.maxDeliver,
      ack_wait: nanos(this.opts.ackWaitMs ?? 30_000),
      max_ack_pending: 256,
    };
    try {
      await this.jsm.consumers.info(EVENTS_STREAM, this.opts.durable);
      await this.jsm.consumers.update(EVENTS_STREAM, this.opts.durable, config);
    } catch (err) {
      if (err instanceof JetStreamApiError && err.status === 404) {
        await this.jsm.consumers.add(EVENTS_STREAM, config);
      } else {
        throw err;
      }
    }
    const consumer = await this.js.consumers.get(EVENTS_STREAM, this.opts.durable);
    this.messages = await consumer.consume({ max_messages: 64 });
    const deps: ProcessDeps = {
      service: this.opts.service,
      durable: this.opts.durable,
      handler: this.opts.handler,
      policy: this.policy,
      logger: this.logger,
      deadLetters: new JetStreamDeadLetterSink(this.js),
      ...(this.flow ? { flow: this.flow } : {}),
      ...(this.metrics ? { metrics: this.metrics } : {}),
    };
    const messages = this.messages;
    this.loop = (async () => {
      for await (const m of messages) {
        await processDelivery(
          {
            subject: m.subject,
            data: m.data,
            ...(m.headers ? { headers: m.headers } : {}),
            attempt: m.info.deliveryCount,
            ack: () => m.ack(),
            nak: (d) => m.nak(d),
            term: (r) => m.term(r),
          },
          deps,
        );
      }
    })().catch((err: unknown) => this.logger.error({ err }, 'consumer loop crashed'));
    this.logger.info({ durable: this.opts.durable, types: this.opts.types }, 'durable consumer started');
  }

  /** Stops pulling new messages and waits for the in-flight one to finish (graceful shutdown). */
  async stop(): Promise<void> {
    await this.messages?.close();
    await this.loop;
  }
}
