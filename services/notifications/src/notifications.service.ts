import { type AnyEvent } from '@shopstream/contracts';
import { handleOnce, type HandlerResult, type Logger, type MongoEventStore } from '@shopstream/platform';
import type { NatsConnection } from '@nats-io/transport-node';
import { Schema, type Connection, type Model } from 'mongoose';
import { describeEvent, type Tone } from './describe';

export interface TimelineDoc {
  _id: string; // event id
  orderId: string;
  userId: string;
  type: string;
  source: string;
  title: string;
  detail: string;
  tone: Tone;
  occurredAt: Date;
}

export interface NotificationDoc {
  _id: string;
  userId: string;
  orderId: string;
  type: string;
  title: string;
  body: string;
  tone: Tone;
  read: boolean;
  createdAt: Date;
}

const timelineSchema = new Schema<TimelineDoc>(
  {
    _id: String,
    orderId: { type: String, required: true },
    userId: { type: String, required: true },
    type: String,
    source: String,
    title: String,
    detail: String,
    tone: String,
    occurredAt: Date,
  },
  { collection: 'timeline', versionKey: false },
);
timelineSchema.index({ orderId: 1, occurredAt: 1 });

const notificationSchema = new Schema<NotificationDoc>(
  {
    _id: String,
    userId: { type: String, required: true },
    orderId: String,
    type: String,
    title: String,
    body: String,
    tone: String,
    read: { type: Boolean, default: false },
    createdAt: Date,
  },
  { collection: 'notifications', versionKey: false },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

/** Core-NATS subject used to fan live updates out to every notifications replica's SSE clients. */
export const userPushSubject = (userId: string) => `shopstream.push.${userId}`;
export const PUSH_WILDCARD = 'shopstream.push.*';

export interface PushMessage {
  kind: 'timeline';
  orderId: string;
  entry: ReturnType<typeof toTimelineView>;
  notification?: ReturnType<typeof toNotificationView>;
}

export function toTimelineView(d: TimelineDoc) {
  return {
    id: d._id,
    orderId: d.orderId,
    type: d.type,
    source: d.source,
    title: d.title,
    detail: d.detail,
    tone: d.tone,
    occurredAt: d.occurredAt.toISOString(),
  };
}

export function toNotificationView(d: NotificationDoc) {
  return {
    id: d._id,
    orderId: d.orderId,
    type: d.type,
    title: d.title,
    body: d.body,
    tone: d.tone,
    read: d.read,
    createdAt: d.createdAt.toISOString(),
  };
}

export class NotificationsService {
  readonly timeline: Model<TimelineDoc>;
  readonly notifications: Model<NotificationDoc>;

  constructor(
    conn: Connection,
    private readonly store: MongoEventStore,
    private readonly nc: NatsConnection,
    private readonly logger: Logger,
  ) {
    this.timeline = conn.model<TimelineDoc>('TimelineEntry', timelineSchema);
    this.notifications = conn.model<NotificationDoc>('Notification', notificationSchema);
  }

  async init(): Promise<void> {
    await Promise.all([this.timeline.createCollection(), this.notifications.createCollection()]).catch(
      () => undefined,
    );
    await Promise.all([this.timeline.syncIndexes(), this.notifications.syncIndexes()]);
  }

  async handle(event: AnyEvent): Promise<HandlerResult> {
    const d = describeEvent(event);
    const data = event.data as { orderId?: string; userId?: string };
    if (!d || !data.orderId || !data.userId) return 'processed';
    const { orderId, userId } = data;
    const occurredAt = new Date(event.occurredAt);
    const result = await handleOnce(this.store, 'notifications-feed', event.id, async (session) => {
      const entry: TimelineDoc = {
        _id: event.id,
        orderId,
        userId,
        type: event.type,
        source: event.source,
        title: d.title,
        detail: d.detail,
        tone: d.tone,
        occurredAt,
      };
      await this.timeline.create([entry], { session });
      let notification: NotificationDoc | undefined;
      if (d.notify) {
        notification = {
          _id: event.id,
          userId,
          orderId,
          type: event.type,
          title: d.title,
          body: d.detail,
          tone: d.tone,
          read: false,
          createdAt: occurredAt,
        };
        await this.notifications.create([notification], { session });
      }
      return { entry, notification };
    });
    if (result.duplicate) return 'duplicate';
    // Push after commit. Core NATS fan-out reaches the SSE clients of every replica.
    const push: PushMessage = {
      kind: 'timeline',
      orderId,
      entry: toTimelineView(result.result.entry),
      ...(result.result.notification ? { notification: toNotificationView(result.result.notification) } : {}),
    };
    this.nc.publish(userPushSubject(userId), JSON.stringify(push));
    this.logger.debug({ orderId, type: event.type }, 'timeline updated');
    return 'processed';
  }

  timelineFor(orderId: string, userId: string) {
    return this.timeline.find({ orderId, userId }).sort({ occurredAt: 1, _id: 1 }).lean();
  }

  feed(userId: string, first: number) {
    return this.notifications
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(first, 1), 50))
      .lean();
  }

  unreadCount(userId: string) {
    return this.notifications.countDocuments({ userId, read: false });
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await this.notifications.updateMany({ userId, read: false }, { $set: { read: true } });
    return res.modifiedCount;
  }
}
