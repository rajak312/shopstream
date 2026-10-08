import { tokenizeCard } from '@shopstream/contracts';
import { describe, expect, it } from 'vitest';
import { TransientProcessorError, refundDecision, simulateCharge } from './processor';

const tok = (n: string) => tokenizeCard(n).token;

describe('simulated processor', () => {
  it('authorizes the success cards', () => {
    expect(simulateCharge(tok('4242424242424242'), 1)).toEqual({ ok: true });
    expect(simulateCharge(tok('5555555555554444'), 1)).toEqual({ ok: true });
  });

  it('declines deterministically', () => {
    expect(simulateCharge(tok('4000000000000002'), 1)).toMatchObject({ ok: false, code: 'card_declined' });
    expect(simulateCharge(tok('4000000000009995'), 1)).toMatchObject({
      ok: false,
      code: 'insufficient_funds',
    });
  });

  it('fails the flaky card transiently twice, then succeeds (JetStream redelivery)', () => {
    const t = tok('4000000000000119');
    expect(() => simulateCharge(t, 1)).toThrow(TransientProcessorError);
    expect(() => simulateCharge(t, 2)).toThrow(TransientProcessorError);
    expect(simulateCharge(t, 3)).toEqual({ ok: true });
  });
});

describe('refundDecision (compensation)', () => {
  it('refunds a captured payment', () => expect(refundDecision('SUCCEEDED')).toBe('refund'));
  it('tombstones when the cancel arrives before the charge', () =>
    expect(refundDecision(undefined)).toBe('tombstone'));
  it('ignores failed / already refunded payments', () => {
    expect(refundDecision('FAILED')).toBe('none');
    expect(refundDecision('REFUNDED')).toBe('none');
  });
});
