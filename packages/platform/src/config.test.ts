import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ConfigError, baseEnvSchema, loadConfig, parseOrigins } from './config';

describe('config', () => {
  const schema = baseEnvSchema.extend({ PORT: z.coerce.number().int() });

  it('applies defaults and coerces values', () => {
    const cfg = loadConfig(schema, { JWT_SECRET: 'x'.repeat(16), PORT: '4001' });
    expect(cfg.PORT).toBe(4001);
    expect(cfg.NATS_URL).toBe('nats://localhost:4222');
  });

  it('fails fast listing every invalid variable', () => {
    expect(() => loadConfig(schema, { JWT_SECRET: 'short', PORT: 'abc' })).toThrow(ConfigError);
    try {
      loadConfig(schema, { JWT_SECRET: 'short', PORT: 'abc' });
    } catch (err) {
      expect((err as Error).message).toMatch(/JWT_SECRET/);
      expect((err as Error).message).toMatch(/PORT/);
    }
  });

  it('parses CORS origins', () => {
    expect(parseOrigins('https://a.dev, https://b.dev')).toEqual(['https://a.dev', 'https://b.dev']);
    expect(parseOrigins('*')).toBe(true);
  });
});
