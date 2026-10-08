import mongoose, { type Connection } from 'mongoose';
import type { Logger } from '../logger';

export async function connectMongo(
  uri: string,
  dbName: string,
  logger: Logger,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<Connection> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    attempt++;
    const conn = mongoose.createConnection(uri, {
      dbName,
      serverSelectionTimeoutMS: 5_000,
      maxPoolSize: 10,
      minPoolSize: 0,
      autoIndex: true,
    });
    try {
      await conn.asPromise();
      logger.info({ dbName }, 'connected to MongoDB');
      return conn;
    } catch (err) {
      await conn.close().catch(() => undefined);
      if (Date.now() > deadline) throw err;
      logger.warn({ attempt, err: (err as Error).message }, 'MongoDB not reachable yet, retrying');
      await new Promise((r) => setTimeout(r, Math.min(500 * attempt, 3_000)));
    }
  }
}

export async function pingMongo(conn: Connection): Promise<void> {
  if (!conn.db) throw new Error('MongoDB connection not established');
  await conn.db.admin().command({ ping: 1 });
}
