import { describe, expect, test } from 'vitest';
import { BudgetError, checkBudget, limitsFrom, secondsUntilUtcMidnight, utcDay } from './budget.ts';

describe('limitsFrom', () => {
  test.each([
    ['100000', 95_000, 70_000],
    ['50', 47, 35],
    [undefined, 95_000, 70_000],
    ['', 95_000, 70_000],
    ['many', 95_000, 70_000],
    ['-5', 95_000, 70_000],
  ])('turns %s into the limits %s and %s', (value, limit, backfillLimit) => {
    expect(limitsFrom(value)).toEqual({ limit, backfillLimit });
  });
});

describe('secondsUntilUtcMidnight', () => {
  test.each([
    ['2026-11-27T22:30:00.000Z', 5400],
    ['2026-11-27T00:00:00.000Z', 86_400],
    ['2026-11-27T23:59:59.500Z', 1],
    ['2026-12-31T12:00:00.000Z', 43_200],
  ])('counts from %s to the next 00:00 UTC', (now, seconds) => {
    expect(secondsUntilUtcMidnight(new Date(now))).toBe(seconds);
  });
});

test('utcDay gives the UTC date', () => {
  expect(utcDay(new Date('2026-11-27T23:59:59Z'))).toBe('2026-11-27');
});

describe('checkBudget', () => {
  const now = new Date('2026-11-27T22:30:00Z');

  test('accepts a cost that ends at the ceiling', () => {
    expect(() => checkBudget(90, 5, 95, now)).not.toThrow();
  });

  test('refuses a cost that ends above the ceiling and gives the retry time', () => {
    const attempt = () => checkBudget(90, 6, 95, now);

    expect(attempt).toThrow(BudgetError);
    expect(attempt).toThrow(expect.objectContaining({ used: 90, cost: 6, ceiling: 95, retryAfter: 5400 }));
  });

  test('says when the cost is above the ceiling for any day', () => {
    expect(() => checkBudget(0, 96, 95, now)).toThrow('the limit for one day is 95 rows');
  });
});
