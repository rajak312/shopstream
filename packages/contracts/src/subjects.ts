import type { EventType, ServiceName } from './events';

export const EVENTS_STREAM = 'SHOPSTREAM_EVENTS';
export const DLQ_STREAM = 'SHOPSTREAM_DLQ';
export const EVENT_SUBJECT_PREFIX = 'shopstream.events';
export const DLQ_SUBJECT_PREFIX = 'shopstream.dlq';
/** Core-NATS (non-persistent) subject used for live delivery telemetry in the event-flow visualizer. */
export const FLOW_SUBJECT = 'shopstream.flow';

export function eventSubject(type: EventType): string {
  return `${EVENT_SUBJECT_PREFIX}.${type}`;
}

export function dlqSubject(consumer: ServiceName, type: string): string {
  return `${DLQ_SUBJECT_PREFIX}.${consumer}.${type}`;
}

export function typeFromSubject(subject: string): string {
  return subject.startsWith(`${EVENT_SUBJECT_PREFIX}.`)
    ? subject.slice(EVENT_SUBJECT_PREFIX.length + 1)
    : subject;
}
