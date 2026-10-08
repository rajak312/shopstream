import { trace } from '@opentelemetry/api';
import pino, { type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

/**
 * Structured JSON logger. Every line carries the service name and, when a span
 * is active, the W3C trace id / span id so logs can be joined with traces.
 */
export function createLogger(service: string, level: LoggerOptions['level'] = 'info'): Logger {
  return pino({
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.cardNumber'],
      censor: '[redacted]',
    },
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const ctx = span.spanContext();
      return { trace_id: ctx.traceId, span_id: ctx.spanId };
    },
  });
}
