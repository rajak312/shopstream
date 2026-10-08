import type { LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';

/** Routes Nest's internal logs through pino so everything is structured JSON. */
const CLIENT_ERROR_CODES = new Set([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'BAD_USER_INPUT',
  'NOT_FOUND',
  'RATE_LIMITED',
]);

export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  private write(level: 'info' | 'error' | 'warn' | 'debug' | 'trace', message: unknown, params: unknown[]) {
    const context = typeof params.at(-1) === 'string' ? (params.at(-1) as string) : undefined;
    // Expected client errors (bad input, missing auth) surface in resolvers as exceptions;
    // they are part of normal operation, not server errors.
    const code = (message as { extensions?: { code?: string } } | null)?.extensions?.code;
    if (level === 'error' && code && CLIENT_ERROR_CODES.has(code)) level = 'debug';
    if (message instanceof Error) {
      this.logger[level]({ err: message, context }, message.message);
    } else if (typeof message === 'object' && message !== null) {
      this.logger[level]({ ...(message as object), context });
    } else {
      const stack =
        level === 'error' && typeof params[0] === 'string' && params.length > 1 ? params[0] : undefined;
      this.logger[level]({ context, ...(stack ? { stack } : {}) }, String(message));
    }
  }

  log(message: unknown, ...params: unknown[]) {
    this.write('info', message, params);
  }
  error(message: unknown, ...params: unknown[]) {
    this.write('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]) {
    this.write('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]) {
    this.write('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]) {
    this.write('trace', message, params);
  }
  fatal(message: unknown, ...params: unknown[]) {
    this.write('error', message, params);
  }
}
