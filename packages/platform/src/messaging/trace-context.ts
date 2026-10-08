import { context, propagation, type Context } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

// Make sure W3C propagation works even when the OTel SDK is disabled (tests, demo).
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

/** Serializes the active trace context (traceparent/tracestate) into a plain header map. */
export function currentTraceHeaders(ctx: Context = context.active()): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(ctx, carrier);
  return carrier;
}

export interface HeaderReader {
  get(key: string): string;
  keys(): string[];
}

/** Rebuilds a parent context from message headers so consumer spans join the producer's trace. */
export function contextFromHeaders(headers: HeaderReader | undefined): Context {
  if (!headers) return context.active();
  return propagation.extract(context.active(), headers, {
    get: (carrier, key) => carrier.get(key) || undefined,
    keys: (carrier) => carrier.keys(),
  });
}

export function traceIdFromHeaders(headers: Record<string, string>): string | undefined {
  const tp = headers.traceparent;
  if (!tp) return undefined;
  const parts = tp.split('-');
  return parts[1] && parts[1] !== '0'.repeat(32) ? parts[1] : undefined;
}
