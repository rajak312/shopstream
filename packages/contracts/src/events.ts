import { z } from 'zod';
import { CANCELLATION_REASONS } from './status';

/**
 * Event envelope, loosely modelled on CloudEvents. Every message on the bus is
 * validated against this schema on publish *and* on consume, so a producer can
 * never put a malformed event on the wire and a consumer never trusts input.
 */
const cents = z.number().int().safe();
const id = z.string().min(1);

const orderLine = z.object({
  productId: id,
  sku: z.string(),
  name: z.string(),
  quantity: z.number().int().positive(),
  unitPriceCents: cents.nonnegative(),
});

const stockLine = z.object({ productId: id, quantity: z.number().int().positive() });

export const eventPayloadSchemas = {
  'catalog.product.upserted': z.object({
    productId: id,
    sku: z.string(),
    slug: z.string(),
    name: z.string(),
    priceCents: cents.nonnegative(),
    currency: z.literal('USD'),
    imageUrl: z.string(),
  }),
  'order.created': z.object({
    orderId: id,
    orderNumber: z.string(),
    userId: id,
    items: z.array(orderLine).min(1),
    subtotalCents: cents,
    shippingCents: cents,
    taxCents: cents,
    totalCents: cents,
    currency: z.literal('USD'),
    payment: z.object({ token: z.string(), brand: z.string(), last4: z.string().length(4) }),
  }),
  'order.confirmed': z.object({ orderId: id, userId: id, totalCents: cents }),
  'order.cancelled': z.object({
    orderId: id,
    userId: id,
    reason: z.enum(CANCELLATION_REASONS),
    detail: z.string().optional(),
  }),
  'order.shipped': z.object({
    orderId: id,
    userId: id,
    carrier: z.string(),
    trackingNumber: z.string(),
  }),
  'order.delivered': z.object({ orderId: id, userId: id }),
  'inventory.reserved': z.object({ orderId: id, userId: id, items: z.array(stockLine).min(1) }),
  'inventory.rejected': z.object({
    orderId: id,
    userId: id,
    reason: z.string(),
    unavailable: z.array(
      z.object({ productId: id, requested: z.number().int(), available: z.number().int() }),
    ),
  }),
  'inventory.released': z.object({ orderId: id, userId: id, reason: z.string() }),
  'inventory.committed': z.object({ orderId: id, userId: id }),
  'payment.succeeded': z.object({
    orderId: id,
    userId: id,
    paymentId: id,
    amountCents: cents,
    currency: z.literal('USD'),
    brand: z.string(),
    last4: z.string(),
  }),
  'payment.failed': z.object({
    orderId: id,
    userId: id,
    paymentId: id,
    amountCents: cents,
    currency: z.literal('USD'),
    code: z.string(),
    message: z.string(),
  }),
  'payment.refunded': z.object({
    orderId: id,
    userId: id,
    paymentId: id,
    amountCents: cents,
    currency: z.literal('USD'),
    reason: z.string(),
  }),
} as const;

export type EventType = keyof typeof eventPayloadSchemas;
export const EVENT_TYPES = Object.keys(eventPayloadSchemas) as EventType[];
export type EventPayload<T extends EventType> = z.infer<(typeof eventPayloadSchemas)[T]>;

export const SERVICE_NAMES = ['gateway', 'catalog', 'orders', 'payments', 'notifications'] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export const envelopeSchema = z.object({
  id: z.uuid(),
  type: z.enum(EVENT_TYPES as [EventType, ...EventType[]]),
  version: z.literal(1),
  source: z.enum(SERVICE_NAMES),
  occurredAt: z.iso.datetime(),
  /** Groups every event of one business transaction (the order id for the checkout saga). */
  correlationId: z.string(),
  /** Id of the event that caused this one, if any. */
  causationId: z.string().optional(),
  data: z.unknown(),
});

export type EventEnvelope<T extends EventType = EventType> = Omit<
  z.infer<typeof envelopeSchema>,
  'type' | 'data'
> & { type: T; data: EventPayload<T> };

export type AnyEvent = { [T in EventType]: EventEnvelope<T> }[EventType];

export class EventValidationError extends Error {
  override readonly name = 'EventValidationError';
  constructor(
    message: string,
    readonly issues: unknown,
  ) {
    super(message);
  }
}

export interface CreateEventOptions {
  correlationId?: string;
  causationId?: string;
  id?: string;
  occurredAt?: Date;
}

export function createEvent<T extends EventType>(
  type: T,
  source: ServiceName,
  data: EventPayload<T>,
  options: CreateEventOptions = {},
): EventEnvelope<T> {
  const parsed = eventPayloadSchemas[type].safeParse(data);
  if (!parsed.success) {
    throw new EventValidationError(`Invalid payload for ${type}`, parsed.error.issues);
  }
  const payload = parsed.data as EventPayload<T>;
  const correlation = options.correlationId ?? ('orderId' in payload ? String(payload.orderId) : undefined);
  return {
    id: options.id ?? globalThis.crypto.randomUUID(),
    type,
    version: 1,
    source,
    occurredAt: (options.occurredAt ?? new Date()).toISOString(),
    correlationId: correlation ?? globalThis.crypto.randomUUID(),
    ...(options.causationId ? { causationId: options.causationId } : {}),
    data: payload,
  };
}

/** Validates an unknown value (e.g. a decoded NATS message) into a typed event. */
export function parseEvent(raw: unknown): AnyEvent {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new EventValidationError('Invalid event envelope', envelope.error.issues);
  }
  const payload = eventPayloadSchemas[envelope.data.type].safeParse(envelope.data.data);
  if (!payload.success) {
    throw new EventValidationError(`Invalid payload for ${envelope.data.type}`, payload.error.issues);
  }
  return { ...envelope.data, data: payload.data } as AnyEvent;
}

export function isEventOfType<T extends EventType>(
  event: AnyEvent,
  type: T,
): event is Extract<AnyEvent, { type: T }> {
  return event.type === type;
}
