/**
 * Deterministic test cards, modelled on Stripe's well-known test numbers.
 * The orders service tokenizes the raw number at checkout (only brand + last4
 * + token are ever stored or put on the wire); the payments simulator decides
 * the outcome from the token.
 */
export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'unknown';
export type CardOutcome = 'succeeded' | 'declined' | 'insufficient_funds' | 'flaky';

export interface TestCard {
  number: string;
  brand: CardBrand;
  outcome: CardOutcome;
  label: string;
  description: string;
}

export const TEST_CARDS: readonly TestCard[] = [
  {
    number: '4242424242424242',
    brand: 'visa',
    outcome: 'succeeded',
    label: 'Visa · succeeds',
    description: 'Payment is authorized immediately.',
  },
  {
    number: '5555555555554444',
    brand: 'mastercard',
    outcome: 'succeeded',
    label: 'Mastercard · succeeds',
    description: 'Payment is authorized immediately.',
  },
  {
    number: '4000000000000002',
    brand: 'visa',
    outcome: 'declined',
    label: 'Visa · declined',
    description: 'Card is declined; the saga releases inventory and cancels the order.',
  },
  {
    number: '4000000000009995',
    brand: 'visa',
    outcome: 'insufficient_funds',
    label: 'Visa · insufficient funds',
    description: 'Declined with insufficient_funds; triggers compensation.',
  },
  {
    number: '4000000000000119',
    brand: 'visa',
    outcome: 'flaky',
    label: 'Visa · flaky processor',
    description:
      'Processor errors on the first two attempts; JetStream redelivers and the third attempt succeeds.',
  },
];

/** Number of failed deliveries before a "flaky" card goes through. */
export const FLAKY_CARD_FAILURES = 2;

export function normalizeCardNumber(input: string): string {
  return input.replace(/[\s-]/g, '');
}

export function luhnValid(input: string): boolean {
  const digits = normalizeCardNumber(input);
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function detectBrand(input: string): CardBrand {
  const n = normalizeCardNumber(input);
  if (/^4/.test(n)) return 'visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  return 'unknown';
}

export interface CardToken {
  token: string;
  brand: CardBrand;
  last4: string;
}

export class InvalidCardError extends Error {
  override readonly name = 'InvalidCardError';
}

/** Simulated tokenization: the PAN never leaves the orders service. */
export function tokenizeCard(input: string): CardToken {
  const number = normalizeCardNumber(input);
  if (!luhnValid(number)) {
    throw new InvalidCardError('Card number is invalid');
  }
  const brand = detectBrand(number);
  const known = TEST_CARDS.find((c) => c.number === number);
  const outcome: CardOutcome = known?.outcome ?? 'succeeded';
  return { token: `tok_${outcome}_${brand}_${number.slice(-4)}`, brand, last4: number.slice(-4) };
}

export function outcomeForToken(token: string): CardOutcome {
  const match = /^tok_([a-z_]+?)_(visa|mastercard|amex|unknown)_\d{4}$/.exec(token);
  const outcome = match?.[1];
  switch (outcome) {
    case 'succeeded':
    case 'declined':
    case 'insufficient_funds':
    case 'flaky':
      return outcome;
    default:
      return 'declined';
  }
}
