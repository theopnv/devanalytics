import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../core/contract.ts';
import { metric } from './metric.ts';
import snapshot from './fixtures/snapshot.json' with { type: 'json' };

describe('complexity metric', () => {
  it('parses the fixture snapshot', () => {
    // Act
    const result = metric.parse(snapshot);

    // Assert
    expect(result).toEqual(snapshot);
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
    ['a missing cognitive limit', { ...snapshot, cognitive_limit: undefined }],
    ['a cyclomatic limit that is not an integer', { ...snapshot, cyclomatic_limit: 1.5 }],
    ['functions that are not an array', { ...snapshot, functions: {} }],
    ['a score that is not an integer', { ...snapshot, functions: [{ ...snapshot.functions[0], cognitive: 1.5 }] }],
    ['a missing is_test flag', { ...snapshot, functions: [{ ...snapshot.functions[0], is_test: undefined }] }],
  ])('refuses %s', (_label, body) => {
    // Act
    const parse = () => metric.parse(body);

    // Assert
    expect(parse).toThrow(ValidationError);
  });
});
