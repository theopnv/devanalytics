import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../core/contract.ts';
import { metric } from './metric.ts';
import snapshot from './fixtures/snapshot.json' with { type: 'json' };

describe('coverage metric', () => {
  it('parses the fixture snapshot', () => {
    // Act
    const result = metric.parse(snapshot);

    // Assert
    expect(result).toEqual(snapshot);
  });

  it('accepts a snapshot without test counts', () => {
    // Act
    const result = metric.parse({ ...snapshot, tests: undefined });

    // Assert
    expect(result).not.toHaveProperty('tests');
  });

  it('converts the date to UTC so that dates sort as text', () => {
    // Act
    const result = metric.parse({ ...snapshot, date: '2026-10-20T17:56:56+02:00' });

    // Assert
    expect(result.date).toBe('2026-10-20T15:56:56.000Z');
  });

  it.each([
    ['a body that is not an object', []],
    ['a bad sha', { ...snapshot, sha: 'main' }],
    ['a bad date', { ...snapshot, date: 'yesterday' }],
    ['no suite', { ...snapshot, suites: {} }],
    ['no total suite', { ...snapshot, suites: { unit: snapshot.suites.unit } }],
    ['a suite name with a space', { ...snapshot, suites: { ...snapshot.suites, 'my suite': [] } }],
    ['a suite name that is a prototype key', JSON.parse(`{"sha":"${'a'.repeat(40)}","date":"2026-01-01","suites":{"__proto__":[],"total":[]}}`)],
    ['more than 20 suites', { ...snapshot, suites: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i === 0 ? 'total' : `s${i}`, []])) }],
    ['files that are not an array', { ...snapshot, suites: { total: {} } }],
    ['a count that is not an integer', { ...snapshot, suites: { total: [{ ...snapshot.suites.total[0], lines: [0.5, 2] }] } }],
    ['a count that is not a pair', { ...snapshot, suites: { total: [{ ...snapshot.suites.total[0], lines: [1] }] } }],
    ['test counts that miss a field', { ...snapshot, tests: { unit: { files: 1 } } }],
  ])('refuses %s', (_label, body) => {
    // Act
    const parse = () => metric.parse(body);

    // Assert
    expect(parse).toThrow(ValidationError);
  });
});
