import { createEvent, type AnyEvent } from '@shopstream/contracts';
import {
  badInput,
  decodeCursor,
  encodeCursor,
  handleOnce,
  notFound,
  type HandlerResult,
  type Logger,
} from '@shopstream/platform';
import { CheckoutError, checkoutInputSchema, planCheckout, type CheckoutInput } from '../domain/checkout';
import {
  InvalidTransitionError,
  transition,
  type OrderState,
  type SagaInput,
} from '../domain/order-state-machine';
import type { PrismaEventStore } from '../infra/outbox.store';
import { Prisma, type PrismaClient, type Tx } from '../infra/prisma';
import { eventsForEffects } from './order.events';

const orderInclude = {
  items: true,
  history: { orderBy: { at: 'asc' } },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export class ConcurrentModificationError extends Error {
  override readonly name = 'ConcurrentModificationError';
}

export class OrdersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly store: PrismaEventStore,
    private readonly logger: Logger,
    private readonly onCommitted: () => void,
  ) {}

  // ---------------------------------------------------------------- checkout

  async checkout(userId: string, rawInput: CheckoutInput): Promise<OrderWithRelations> {
    const parsed = checkoutInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw badInput(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const input = parsed.data;

    const existing = await this.prisma.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
      include: orderInclude,
    });
    if (existing) return existing; // safe client retry: same key -> same order

    const cart = await this.prisma.cart.findUnique({ where: { userId }, include: { items: true } });
    const items = cart?.items ?? [];
    const snapshots = await this.prisma.productSnapshot.findMany({
      where: { id: { in: items.map((i) => i.productId) } },
    });
    let plan;
    try {
      plan = planCheckout(items, new Map(snapshots.map((s) => [s.id, s])), input);
    } catch (err) {
      if (err instanceof CheckoutError) throw badInput(err.message);
      throw err;
    }

    try {
      const order = await this.store.transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            userId,
            idempotencyKey: input.idempotencyKey,
            ...plan.totals,
            cardBrand: plan.card.brand,
            cardLast4: plan.card.last4,
            shippingAddress: input.shippingAddress,
            items: { create: plan.lines },
            history: { create: { from: null, to: 'PENDING', reason: 'Order placed' } },
          },
          include: orderInclude,
        });
        await tx.cartItem.deleteMany({ where: { cartId: cart!.id } });
        await this.store.enqueue(tx, [
          createEvent('order.created', 'orders', {
            orderId: created.id,
            orderNumber: created.number,
            userId,
            items: plan.lines.map((l) => ({
              productId: l.productId,
              sku: l.sku,
              name: l.name,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
            })),
            ...plan.totals,
            currency: 'USD',
            payment: { token: plan.card.token, brand: plan.card.brand, last4: plan.card.last4 },
          }),
        ]);
        return created;
      });
      this.onCommitted();
      this.logger.info(
        { orderId: order.id, number: order.number, totalCents: order.totalCents },
        'order placed',
      );
      return order;
    } catch (err) {
      // Two concurrent requests with the same idempotency key: return the winner's order.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.order.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
          include: orderInclude,
        });
        if (winner) return winner;
      }
      throw err;
    }
  }

  async cancelByCustomer(userId: string, orderId: string): Promise<OrderWithRelations> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw notFound('Order not found');
    try {
      await this.store.transaction((tx) =>
        this.apply(tx, orderId, { type: 'cancel', reason: 'customer_request' }),
      );
    } catch (err) {
      if (err instanceof InvalidTransitionError)
        throw badInput(`Order can no longer be cancelled (${err.from})`);
      throw err;
    }
    this.onCommitted();
    return this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
  }

  // ------------------------------------------------------------------- saga

  /** Durable-consumer entry point for saga events coming from payments and catalog. */
  async handleSagaEvent(event: AnyEvent): Promise<HandlerResult> {
    const input = toSagaInput(event);
    if (!input) return 'processed';
    const orderId = 'orderId' in event.data ? event.data.orderId : undefined;
    if (!orderId) return 'processed';
    const outcome = await handleOnce(this.store, 'orders-saga', event.id, (tx) =>
      this.apply(tx, orderId, input, event.id),
    );
    if (outcome.duplicate) return 'duplicate';
    if (outcome.result.length > 0) this.onCommitted();
    return 'processed';
  }

  /**
   * Loads the order, runs the pure state machine and persists the result with
   * an optimistic version check. Effects become outbox events in the same tx.
   */
  private async apply(tx: Tx, orderId: string, input: SagaInput, causationId?: string): Promise<AnyEvent[]> {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      // Unknown order: nothing we can do; ack so it does not loop forever.
      this.logger.warn({ orderId, input: input.type }, 'saga event for unknown order');
      return [];
    }
    const current: OrderState = {
      status: order.status,
      paymentStatus: order.paymentStatus,
      inventoryStatus: order.inventoryStatus,
    };
    const result = transition(current, input);
    const { next } = result;
    const statusChanged = next.status !== current.status;
    const anyChange =
      statusChanged ||
      next.paymentStatus !== current.paymentStatus ||
      next.inventoryStatus !== current.inventoryStatus;
    if (!anyChange) return [];

    const now = new Date();
    const updated = await tx.order.updateMany({
      where: { id: orderId, version: order.version },
      data: {
        ...next,
        version: { increment: 1 },
        ...(statusChanged && next.status === 'CONFIRMED' ? { confirmedAt: now } : {}),
        ...(statusChanged && next.status === 'SHIPPED' ? { shippedAt: now } : {}),
        ...(statusChanged && next.status === 'DELIVERED' ? { deliveredAt: now } : {}),
        ...(statusChanged && next.status === 'CANCELLED'
          ? { cancellationReason: result.reason ?? null }
          : {}),
      },
    });
    if (updated.count !== 1) {
      throw new ConcurrentModificationError(`Order ${orderId} changed concurrently; retrying`);
    }
    if (statusChanged) {
      await tx.orderStatusChange.create({
        data: {
          orderId,
          from: current.status,
          to: next.status,
          reason: result.reason ?? null,
          eventId: causationId ?? null,
        },
      });
    }
    const events = eventsForEffects(order, result.effects, causationId);
    await this.store.enqueue(tx, events);
    if (statusChanged) {
      this.logger.info(
        { orderId, from: current.status, to: next.status, input: input.type },
        'order status changed',
      );
    }
    return events;
  }

  /**
   * Simulated warehouse: ships confirmed orders after a short delay and marks
   * shipped orders delivered later. Runs as a background loop.
   */
  async fulfillmentTick(shipAfterMs: number, deliverAfterMs: number): Promise<number> {
    const now = Date.now();
    const [toShip, toDeliver] = await Promise.all([
      this.prisma.order.findMany({
        where: { status: 'CONFIRMED', confirmedAt: { lte: new Date(now - shipAfterMs) } },
        select: { id: true },
        take: 25,
      }),
      this.prisma.order.findMany({
        where: { status: 'SHIPPED', shippedAt: { lte: new Date(now - deliverAfterMs) } },
        select: { id: true },
        take: 25,
      }),
    ]);
    let moved = 0;
    for (const [ids, input] of [
      [toShip, { type: 'ship' }],
      [toDeliver, { type: 'deliver' }],
    ] as const) {
      for (const { id } of ids) {
        try {
          await this.store.transaction((tx) => this.apply(tx, id, input));
          moved++;
        } catch (err) {
          if (!(err instanceof ConcurrentModificationError || err instanceof InvalidTransitionError))
            throw err;
        }
      }
    }
    if (moved > 0) this.onCommitted();
    return moved;
  }

  // ---------------------------------------------------------------- queries

  async getForUser(userId: string, orderId: string): Promise<OrderWithRelations | null> {
    return this.prisma.order.findFirst({ where: { id: orderId, userId }, include: orderInclude });
  }

  async byIdForUser(userId: string, orderId: string): Promise<OrderWithRelations | null> {
    return this.getForUser(userId, orderId);
  }

  async listForUser(userId: string, first = 10, after?: string | null) {
    if (first < 1 || first > 50) throw badInput('first must be between 1 and 50');
    const cursor = after ? decodeCursor<{ c: string; id: string }>(after) : undefined;
    const rows = await this.prisma.order.findMany({
      where: {
        userId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.c) } },
                { createdAt: new Date(cursor.c), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: first + 1,
      include: orderInclude,
    });
    const page = rows.slice(0, first);
    const edges = page.map((node) => ({
      cursor: encodeCursor({ c: node.createdAt.toISOString(), id: node.id }),
      node,
    }));
    return {
      edges,
      pageInfo: { hasNextPage: rows.length > first, endCursor: edges.at(-1)?.cursor ?? null },
      totalCount: await this.prisma.order.count({ where: { userId } }),
    };
  }

  /** Units sold per product, excluding cancelled orders (contributed to the federated Product type). */
  async unitsSold(productIds: readonly string[]): Promise<number[]> {
    const rows = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: { productId: { in: [...productIds] }, order: { status: { not: 'CANCELLED' } } },
      _sum: { quantity: true },
    });
    const map = new Map(rows.map((r) => [r.productId, r._sum.quantity ?? 0]));
    return productIds.map((id) => map.get(id) ?? 0);
  }

  // ------------------------------------------------------- product replica

  async upsertSnapshot(event: AnyEvent): Promise<HandlerResult> {
    if (event.type !== 'catalog.product.upserted') return 'processed';
    const d = event.data;
    await this.prisma.productSnapshot.upsert({
      where: { id: d.productId },
      update: {
        sku: d.sku,
        slug: d.slug,
        name: d.name,
        priceCents: d.priceCents,
        currency: d.currency,
        imageUrl: d.imageUrl,
      },
      create: {
        id: d.productId,
        sku: d.sku,
        slug: d.slug,
        name: d.name,
        priceCents: d.priceCents,
        currency: d.currency,
        imageUrl: d.imageUrl,
      },
    });
    return 'processed'; // naturally idempotent (upsert of the latest state)
  }
}

export function toSagaInput(event: AnyEvent): SagaInput | undefined {
  switch (event.type) {
    case 'payment.succeeded':
      return { type: 'payment.succeeded' };
    case 'payment.failed':
      return { type: 'payment.failed', code: event.data.code, message: event.data.message };
    case 'payment.refunded':
      return { type: 'payment.refunded' };
    case 'inventory.reserved':
      return { type: 'inventory.reserved' };
    case 'inventory.rejected':
      return { type: 'inventory.rejected', reason: event.data.reason };
    case 'inventory.released':
      return { type: 'inventory.released' };
    case 'inventory.committed':
      return { type: 'inventory.committed' };
    default:
      return undefined;
  }
}
