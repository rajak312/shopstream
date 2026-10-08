import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import type { Logger } from '@shopstream/platform';

export interface EmbeddedNats {
  url: string;
  stop(): Promise<void>;
}

/** Starts a local nats-server binary with JetStream (used by the single-container demo). */
export async function startEmbeddedNats(opts: {
  binary: string;
  dataDir: string;
  port: number;
  logger: Logger;
}): Promise<EmbeddedNats> {
  mkdirSync(opts.dataDir, { recursive: true });
  const configPath = join(opts.dataDir, 'nats.conf');
  writeFileSync(
    configPath,
    [
      `listen: 127.0.0.1:${opts.port}`,
      `server_name: shopstream-embedded`,
      `max_payload: 1MB`,
      `jetstream {`,
      `  store_dir: "${opts.dataDir}"`,
      `  max_memory_store: 32MB`,
      `  max_file_store: 512MB`,
      `}`,
    ].join('\n'),
  );
  const child: ChildProcess = spawn(opts.binary, ['-c', configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const log = opts.logger.child({ component: 'nats-server' });
  const forward = (chunk: Buffer) =>
    chunk
      .toString()
      .split('\n')
      .filter(Boolean)
      .forEach((line) => log.info(line.replace(/^\[\d+\]\s*/, '')));
  child.stdout?.on('data', forward);
  child.stderr?.on('data', forward);
  let exited = false;
  child.on('exit', (code) => {
    exited = true;
    log.warn({ code }, 'nats-server exited');
  });

  await waitForPort(opts.port, 15_000, () => exited);
  log.info({ port: opts.port }, 'embedded nats-server ready');

  return {
    url: `nats://127.0.0.1:${opts.port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        if (exited) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      }),
  };
}

async function waitForPort(port: number, timeoutMs: number, failed: () => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (failed()) throw new Error('nats-server exited during start-up');
    const ok = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host: '127.0.0.1' }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`nats-server did not open port ${port} within ${timeoutMs}ms`);
}
