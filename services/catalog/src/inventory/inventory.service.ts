import { createEvent, type AnyEvent, type EventEnvelope } from '@shopstream/contracts';
import { handleOnce, type HandlerResult, type Logger, type MongoEventStore } from '@shopstream/platform';
import type { ClientSession } from 'mongoose';
import type { CatalogModels } from '../models';
import { compensationFor, planReservation } from './reservation-plan';

const CONSUMER = 'catalog-inventory';

/** The catalog's part of the checkout saga: reserve, release (compensation) and commit stock. */
export class InventoryService {
  constructor(
    private readonly models: CatalogModels,
    private readonly store: MongoEventStore,
    private readonly logger: Logger,
    private readonly onCommitted: () => void,
  ) {}

  async handle(event: AnyEvent): Promise<HandlerResult> {
    const outcome = await handleOnce(this.store, CONSUMER, event.id, async (session) => {
      switch (event.type) {
        case 'order.created':
          return this.reserve(event, session);
        case 'order.cancelled':
          return this.release(event, session);
        case 'order.shipped':
          return this.commit(event, session);
        default:
          return [];
      }
    });
    if (outcome.duplicate) return 'duplicate';
    if (outcome.result.length > 0) this.onCommitted();
    return 'processed';
  }

  private async reserve(event: EventEnvelope<'order.created'>, session: ClientSession): Promise<AnyEvent[]> {
    const { orderId, userId, items } = event.data;
    const existing = await this.models.reservations.findById(orderId).session(session).lean();
    if (existing) {
      this.logger.info({ orderId, status: existing.status }, 'reservation already decided, skipping');
      return [];
    }
    const ids = [...new Set(items.map((i) => i.productId))];
    const products = await this.models.products
      .find({ _id: { $in: ids } }, { stock: 1 })
      .session(session)
      .lean();
    const available = new Map(products.map((p) => [p._id, p.stock]));
    const plan = planReservation(items, available);
    const now = new Date();
    const opts = { causationId: event.id, correlationId: event.correlationId };

    if (plan.kind === 'reject') {
      await this.models.reservations.create(
        [{ _id: orderId, userId, items: [], status: 'REJECTED', createdAt: now, updatedAt: now }],
        { session },
      );
      const events = [
        createEvent(
          'inventory.rejected',
          'catalog',
          { orderId, userId, reason: 'insufficient_stock', unavailable: plan.unavailable },
          opts,
        ),
      ];
      await this.store.enqueue(session, events);
      return events;
    }

    for (const line of plan.lines) {
      // Conditional decrement: if a concurrent order took the stock, the transaction aborts and the event is retried.
      const res = await this.models.products.updateOne(
        { _id: line.productId, stock: { $gte: line.quantity } },
        { $inc: { stock: -line.quantity, reserved: line.quantity }, $set: { updatedAt: now } },
        { session },
      );
      if (res.modifiedCount !== 1) {
        throw new Error(`Concurrent stock change on ${line.productId}, retrying`);
      }
    }
    await this.models.reservations.create(
      [{ _id: orderId, userId, items: plan.lines, status: 'RESERVED', createdAt: now, updatedAt: now }],
      { session },
    );
    const events = [
      createEvent('inventory.reserved', 'catalog', { orderId, userId, items: plan.lines }, opts),
    ];
    await this.store.enqueue(session, events);
    return events;
  }

  private async release(
    event: EventEnvelope<'order.cancelled'>,
    session: ClientSession,
  ): Promise<AnyEvent[]> {
    const { orderId, userId, reason } = event.data;
    const reservation = await this.models.reservations.findById(orderId).session(session).lean();
    const action = compensationFor(reservation?.status);
    const now = new Date();
    if (action === 'tombstone') {
      await this.models.reservations.create(
        [{ _id: orderId, userId, items: [], status: 'CANCELLED', createdAt: now, updatedAt: now }],
        { session },
      );
      return [];
    }
    if (action === 'none' || !reservation) return [];
    for (const line of reservation.items) {
      await this.models.products.updateOne(
        { _id: line.productId },
        { $inc: { stock: line.quantity, reserved: -line.quantity }, $set: { updatedAt: now } },
        { session },
      );
    }
    await this.models.reservations.updateOne(
      { _id: orderId },
      { $set: { status: 'RELEASED', updatedAt: now } },
      { session },
    );
    const events = [
      createEvent(
        'inventory.released',
        'catalog',
        { orderId, userId, reason },
        {
          causationId: event.id,
          correlationId: event.correlationId,
        },
      ),
    ];
    await this.store.enqueue(session, events);
    return events;
  }

  private async commit(event: EventEnvelope<'order.shipped'>, session: ClientSession): Promise<AnyEvent[]> {
    const { orderId, userId } = event.data;
    const reservation = await this.models.reservations.findById(orderId).session(session).lean();
    if (reservation?.status !== 'RESERVED') return [];
    const now = new Date();
    for (const line of reservation.items) {
      await this.models.products.updateOne(
        { _id: line.productId },
        { $inc: { reserved: -line.quantity }, $set: { updatedAt: now } },
        { session },
      );
    }
    await this.models.reservations.updateOne(
      { _id: orderId },
      { $set: { status: 'COMMITTED', updatedAt: now } },
      { session },
    );
    const events = [
      createEvent(
        'inventory.committed',
        'catalog',
        { orderId, userId },
        {
          causationId: event.id,
          correlationId: event.correlationId,
        },
      ),
    ];
    await this.store.enqueue(session, events);
    return events;
  }
}
