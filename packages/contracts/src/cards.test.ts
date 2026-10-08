import { describe, expect, it } from 'vitest';
import { InvalidCardError, TEST_CARDS, detectBrand, luhnValid, outcomeForToken, tokenizeCard } from './cards';

describe('cards', () => {
  it('validates every published test card with Luhn', () => {
    for (const card of TEST_CARDS) expect(luhnValid(card.number)).toBe(true);
  });

  it('rejects invalid numbers', () => {
    expect(luhnValid('4242424242424241')).toBe(false);
    expect(luhnValid('abcd')).toBe(false);
    expect(luhnValid('')).toBe(false);
  });

  it('accepts spaces and dashes', () => {
    expect(luhnValid('4242 4242-4242 4242')).toBe(true);
  });

  it('detects brands', () => {
    expect(detectBrand('4242424242424242')).toBe('visa');
    expect(detectBrand('5555555555554444')).toBe('mastercard');
    expect(detectBrand('2221000000000009')).toBe('mastercard');
    expect(detectBrand('378282246310005')).toBe('amex');
  });

  it('tokenizes without leaking the PAN and round-trips the outcome', () => {
    const t = tokenizeCard('4000 0000 0000 0002');
    expect(t).toEqual({ token: 'tok_declined_visa_0002', brand: 'visa', last4: '0002' });
    expect(t.token).not.toContain('4000000000000002');
    expect(outcomeForToken(t.token)).toBe('declined');
    expect(outcomeForToken(tokenizeCard('4000000000009995').token)).toBe('insufficient_funds');
    expect(outcomeForToken(tokenizeCard('4000000000000119').token)).toBe('flaky');
  });

  it('treats unknown valid cards as successful and garbage tokens as declined', () => {
    expect(outcomeForToken(tokenizeCard('4111111111111111').token)).toBe('succeeded');
    expect(outcomeForToken('tok_whatever')).toBe('declined');
  });

  it('throws on invalid card numbers', () => {
    expect(() => tokenizeCard('1234')).toThrow(InvalidCardError);
  });
});
