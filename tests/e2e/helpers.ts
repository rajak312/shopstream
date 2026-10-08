import { createServer } from 'node:net';

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(typeof addr === 'object' && addr ? addr.port : 0));
    });
  });
}

export class GraphQLClient {
  token?: string;
  constructor(private readonly url: string) {}

  async request<T = Record<string, unknown>>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const body = await this.raw(query, variables);
    if (body.errors?.length) throw new Error(`GraphQL: ${JSON.stringify(body.errors)}`);
    return body.data as T;
  }

  async raw(query: string, variables: Record<string, unknown> = {}) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
    return (await res.json()) as {
      data?: unknown;
      errors?: { message: string; extensions?: { code?: string } }[];
    };
  }
}

export async function eventually<T>(
  fn: () => Promise<T>,
  check: (v: T) => boolean,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fn();
    if (check(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`condition not met within ${timeoutMs}ms; last value: ${JSON.stringify(last)}`);
}
