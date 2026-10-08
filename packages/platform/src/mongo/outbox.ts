import { randomUUID } from 'node:crypto';
import { Schema, type ClientSession, type Connection, type Model } from 'mongoose';
import type { AnyEvent } from '@shopstream/contracts';
import type { IdempotencyStore } from '../idempotency';
import { currentTraceHeaders } from '../messaging/trace-context';
import type { OutboxRecord, OutboxStore } from '../outbox/relay';

interface OutboxDoc {
  _id: string;
  event: AnyEvent;
  headers: Record<string, string>;
  createdAt: Date;
  publishedAt: Date | null;
  attempts: number;
  lastError?: string;
  lockedUntil?: Date | null;
  lockedBy?: string | null;
}

interface ProcessedDoc {
  _id: string;
  consumer: string;
  eventId: string;
  processedAt: Date;
}

const outboxSchema = new Schema<OutboxDoc>(
  {
    _id: { type: String, required: true },
    event: { type: Schema.Types.Mixed, required: true },
    headers: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, required: true },
    publishedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastError: String,
    lockedUntil: { type: Date, default: null },
    lockedBy: { type: String, default: null },
  },
  { collection: 'outbox', versionKey: false, minimize: false },
);
outboxSchema.index({ publishedAt: 1, createdAt: 1 });
// Published rows are garbage-collected after 7 days.
outboxSchema.index(
  { publishedAt: 1 },
  { expireAfterSeconds: 7 * 24 * 3600, partialFilterExpression: { publishedAt: { $type: 'date' } } },
);

const processedSchema = new Schema<ProcessedDoc>(
  {
    _id: { type: String, required: true },
    consumer: { type: String, required: true },
    eventId: { type: String, required: true },
    processedAt: { type: Date, required: true },
  },
  { collection: 'processed_events', versionKey: false },
);
processedSchema.index({ processedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

/** Transactional outbox + processed-event markers on MongoDB (requires a replica set, as Atlas provides). */
export class MongoEventStore implements OutboxStore, IdempotencyStore<ClientSession> {
  readonly outbox: Model<OutboxDoc>;
  readonly processed: Model<ProcessedDoc>;
  private readonly instanceId = randomUUID();

  constructor(private readonly conn: Connection) {
    this.outbox = conn.model<OutboxDoc>('Outbox', outboxSchema);
    this.processed = conn.model<ProcessedDoc>('ProcessedEvent', processedSchema);
  }

  async init(): Promise<void> {
    await Promise.all([this.outbox.createCollection(), this.processed.createCollection()]).catch(
      () => undefined,
    );
    await Promise.all([this.outbox.syncIndexes(), this.processed.syncIndexes()]);
  }

  transaction<R>(work: (session: ClientSession) => Promise<R>): Promise<R> {
    return this.conn.transaction(work);
  }

  /** Writes events into the outbox as part of the caller's transaction. */
  async enqueue(session: ClientSession, events: AnyEvent[]): Promise<void> {
    if (events.length === 0) return;
    const headers = currentTraceHeaders();
    const now = Date.now();
    await this.outbox.insertMany(
      events.map((event, i) => ({
        _id: event.id,
        event,
        headers,
        // keep strict order for events emitted by one transaction
        createdAt: new Date(now + i),
        publishedAt: null,
        attempts: 0,
      })),
      { session },
    );
  }

  async markProcessed(session: ClientSession, consumer: string, eventId: string): Promise<boolean> {
    const key = `${consumer}:${eventId}`;
    const existing = await this.processed.findById(key).session(session).lean();
    if (existing) return false;
    await this.processed.create([{ _id: key, consumer, eventId, processedAt: new Date() }], { session });
    return true;
  }

  async claimBatch(limit: number): Promise<OutboxRecord[]> {
    const now = new Date();
    const claimable = {
      publishedAt: null,
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
    };
    const candidates = await this.outbox
      .find(claimable, { _id: 1 })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();
    if (candidates.length === 0) return [];
    const token = `${this.instanceId}:${now.getTime()}`;
    await this.outbox.updateMany(
      { ...claimable, _id: { $in: candidates.map((c) => c._id) } },
      { $set: { lockedUntil: new Date(now.getTime() + 30_000), lockedBy: token } },
    );
    const claimed = await this.outbox.find({ lockedBy: token }).sort({ createdAt: 1 }).lean();
    return claimed.map((d) => ({
      id: d._id,
      event: d.event,
      headers: d.headers ?? {},
      attempts: d.attempts,
    }));
  }

  async markPublished(ids: string[]): Promise<void> {
    await this.outbox.updateMany(
      { _id: { $in: ids } },
      { $set: { publishedAt: new Date(), lockedUntil: null, lockedBy: null }, $inc: { attempts: 1 } },
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.outbox.updateOne(
      { _id: id },
      { $set: { lastError: error.slice(0, 1000), lockedUntil: null, lockedBy: null }, $inc: { attempts: 1 } },
    );
  }

  countPending(): Promise<number> {
    return this.outbox.countDocuments({ publishedAt: null });
  }
}
