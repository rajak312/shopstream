import type { NatsConnection } from '@nats-io/transport-node';
import { FLOW_SUBJECT, type FlowMessage, type ServiceName } from '@shopstream/contracts';

/**
 * Fire-and-forget delivery telemetry on core NATS (not JetStream). It powers the
 * live event-flow visualizer; losing a message here only loses an animation.
 */
export class FlowReporter {
  constructor(
    private readonly nc: NatsConnection | undefined,
    private readonly service: ServiceName,
  ) {}

  report(msg: Omit<FlowMessage, 'service' | 'at'>): void {
    if (!this.nc || this.nc.isClosed() || this.nc.isDraining()) return;
    const full: FlowMessage = { ...msg, service: this.service, at: new Date().toISOString() };
    try {
      this.nc.publish(`${FLOW_SUBJECT}.${this.service}`, JSON.stringify(full));
    } catch {
      /* telemetry must never break the business flow */
    }
  }
}
