import { randomUUID } from 'node:crypto';
import { createEvent, type AnyEvent, type EventEnvelope } from '@shopstream/contracts';
import { handleOnce, type HandlerResult, type Logger, type MongoEventStore } from '@shopstream/platform';
import { Schema, type ClientSession, type Connection, type Model } from 'mongoose';
import { refundDecision, simulateCharge } from './domain/processor';

export type ChargeStatus = 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';

export interface PaymentDoc {
  /** = orderId: at most one payment per order. */
  _id: string;
  paymentId: string;
  userId: string;
  amountCents: number;
  currency: 'USD';
  brand: string;
  last4: string;
  status: ChargeStatus;
  failureCode?: string;
  failureMessage?: string;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
  refundedAt?: Date;
}

const paymentSchema = new Schema<PaymentDoc>(
  {
    _id: String,
    paymentId: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    amountCents: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    brand: String,
    last4: String,
    status: { type: String, required: true },
    failureCode: String,
    failureMessage: String,
    attempts: { type: Number, default: 1 },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    refundedAt: Date,
  },
  { collection: 'payments', versionKey: false },
);

const CONSUMER = 'payments-processor';

export class PaymentsService {
  readonly payments: Model<PaymentDoc>;

  constructor(
    conn: Connection,
    private readonly store: MongoEventStore,
    private readonly logger: Logger,
    private readonly latencyMs: number,
    private readonly onCommitted: () => void,
  ) {
    this.payments = conn.model<PaymentDoc>('Payment', paymentSchema);
  }

  async init(): Promise<void> {
    await this.payments.createCollection().catch(() => undefined);
    await this.payments.syncIndexes();
  }

  async handle(event: AnyEvent, attempt: number): Promise<HandlerResult> {
    if (event.type === 'order.created' && this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }
    const outcome = await handleOnce(this.store, CONSUMER, event.id, async (session) => {
      if (event.type === 'order.created') return this.charge(event, attempt, session);
      if (event.type === 'order.cancelled') return this.refund(event, session);
      return [];
    });
    if (outcome.duplicate) return 'duplicate';
    if (outcome.result.length > 0) this.onCommitted();
    return 'processed';
  }

  private async charge(event: EventEnvelope<'order.created'>, attempt: number, session: ClientSession) {
    const { orderId, userId, totalCents, payment } = event.data;
    const existing = await this.payments.findById(orderId).session(session).lean();
    if (existing) {
      this.logger.info({ orderId, status: existing.status }, 'payment already decided, skipping charge');
      return [];
    }
    const result = simulateCharge(payment.token, attempt); // may throw TransientProcessorError -> retry
    const paymentId = `pay_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const now = new Date();
    await this.payments.create(
      [
        {
          _id: orderId,
          paymentId,
          userId,
          amountCents: totalCents,
          currency: 'USD',
          brand: payment.brand,
          last4: payment.last4,
          status: result.ok ? 'SUCCEEDED' : 'FAILED',
          ...(result.ok ? {} : { failureCode: result.code, failureMessage: result.message }),
          attempts: attempt,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session },
    );
    const opts = { causationId: event.id, correlationId: event.correlationId };
    const events = [
      result.ok
        ? createEvent(
            'payment.succeeded',
            'payments',
            {
              orderId,
              userId,
              paymentId,
              amountCents: totalCents,
              currency: 'USD',
              brand: payment.brand,
              last4: payment.last4,
            },
            opts,
          )
        : createEvent(
            'payment.failed',
            'payments',
            {
              orderId,
              userId,
              paymentId,
              amountCents: totalCents,
              currency: 'USD',
              code: result.code,
              message: result.message,
            },
            opts,
          ),
    ];
    await this.store.enqueue(session, events);
    this.logger.info({ orderId, paymentId, ok: result.ok, attempt }, 'charge processed');
    return events;
  }

  private async refund(event: EventEnvelope<'order.cancelled'>, session: ClientSession) {
    const { orderId, userId, reason } = event.data;
    const existing = await this.payments.findById(orderId).session(session).lean();
    const decision = refundDecision(existing?.status);
    const now = new Date();
    if (decision === 'tombstone') {
      await this.payments.create(
        [
          {
            _id: orderId,
            paymentId: `pay_void_${orderId.replace(/-/g, '').slice(0, 16)}`,
            userId,
            amountCents: 0,
            currency: 'USD',
            brand: 'n/a',
            last4: '0000',
            status: 'CANCELLED',
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
        { session },
      );
      return [];
    }
    if (decision === 'none' || !existing) return [];
    await this.payments.updateOne(
      { _id: orderId },
      { $set: { status: 'REFUNDED', refundedAt: now, updatedAt: now } },
      { session },
    );
    const events = [
      createEvent(
        'payment.refunded',
        'payments',
        {
          orderId,
          userId,
          paymentId: existing.paymentId,
          amountCents: existing.amountCents,
          currency: 'USD',
          reason,
        },
        { causationId: event.id, correlationId: event.correlationId },
      ),
    ];
    await this.store.enqueue(session, events);
    this.logger.info({ orderId, paymentId: existing.paymentId }, 'payment refunded (compensation)');
    return events;
  }

  forOrder(orderId: string, userId: string) {
    return this.payments.findOne({ _id: orderId, userId, status: { $ne: 'CANCELLED' } }).lean();
  }
}
