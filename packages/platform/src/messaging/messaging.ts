import type { ServiceName } from '@shopstream/contracts';
import type { Logger } from '../logger';
import type { ServiceMetrics } from '../metrics';
import { connectNats, ensureStreams, type NatsHandles, type StreamOptions } from './connection';
import { DurableConsumer, type DurableConsumerOptions } from './consumer';
import { FlowReporter } from './flow';
import { JetStreamEventPublisher } from './publisher';

/** Per-service facade over the NATS connection: publisher, consumers, flow telemetry and lifecycle. */
export class Messaging {
  readonly publisher: JetStreamEventPublisher;
  readonly flow: FlowReporter;
  private readonly consumers: DurableConsumer[] = [];

  private constructor(
    readonly handles: NatsHandles,
    private readonly service: ServiceName,
    private readonly logger: Logger,
    private readonly metrics?: ServiceMetrics,
  ) {
    this.flow = new FlowReporter(handles.nc, service);
    this.publisher = new JetStreamEventPublisher(handles.js, this.flow, metrics);
  }

  static async connect(opts: {
    url: string;
    service: ServiceName;
    logger: Logger;
    metrics?: ServiceMetrics;
    streams: StreamOptions;
  }): Promise<Messaging> {
    const handles = await connectNats({
      url: opts.url,
      name: `shopstream-${opts.service}`,
      logger: opts.logger,
    });
    await ensureStreams(handles.jsm, opts.streams);
    return new Messaging(handles, opts.service, opts.logger, opts.metrics);
  }

  async consume(opts: Omit<DurableConsumerOptions, 'service'>): Promise<DurableConsumer> {
    const consumer = new DurableConsumer(
      this.handles.js,
      this.handles.jsm,
      { ...opts, service: this.service },
      this.logger.child({ consumer: opts.durable }),
      this.flow,
      this.metrics,
    );
    await consumer.start();
    this.consumers.push(consumer);
    return consumer;
  }

  async ping(): Promise<void> {
    if (this.handles.nc.isClosed()) throw new Error('NATS connection closed');
    await this.handles.nc.flush();
  }

  /** Stop consumers first (finish in-flight work), then drain the connection. */
  async close(): Promise<void> {
    await Promise.allSettled(this.consumers.map((c) => c.stop()));
    if (!this.handles.nc.isClosed()) await this.handles.nc.drain().catch(() => undefined);
  }
}
