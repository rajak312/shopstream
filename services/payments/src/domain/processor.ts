import { FLAKY_CARD_FAILURES, outcomeForToken } from '@shopstream/contracts';

export type ChargeResult =
  { ok: true } | { ok: false; code: 'card_declined' | 'insufficient_funds'; message: string };

/** A transient processor failure: the handler throws, JetStream redelivers with backoff. */
export class TransientProcessorError extends Error {
  override readonly name = 'TransientProcessorError';
}

/**
 * Deterministic simulated card processor. `attempt` is the JetStream delivery
 * count, which lets the "flaky" test card fail twice and then succeed.
 */
export function simulateCharge(token: string, attempt: number): ChargeResult {
  switch (outcomeForToken(token)) {
    case 'succeeded':
      return { ok: true };
    case 'declined':
      return { ok: false, code: 'card_declined', message: 'Your card was declined.' };
    case 'insufficient_funds':
      return { ok: false, code: 'insufficient_funds', message: 'Your card has insufficient funds.' };
    case 'flaky':
      if (attempt <= FLAKY_CARD_FAILURES) {
        throw new TransientProcessorError(`Processor timeout (attempt ${attempt})`);
      }
      return { ok: true };
  }
}

export type RefundDecision = 'refund' | 'tombstone' | 'none';

/** Compensation on order.cancelled. A missing payment leaves a tombstone so a late order.created is not charged. */
export function refundDecision(status: string | undefined): RefundDecision {
  if (status === undefined) return 'tombstone';
  return status === 'SUCCEEDED' ? 'refund' : 'none';
}
