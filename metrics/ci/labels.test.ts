import { describe, expect, it } from 'vitest';
import { parseLabels } from './labels.ts';

describe('parseLabels', () => {
  it('reads one key=value pair on each line', () => {
    // Act
    const result = parseLabels(' team = web \n\nenv=prod=eu\n');

    // Assert
    expect(result).toEqual({ team: 'web', env: 'prod=eu' });
  });

  it('gives no label for a missing value', () => {
    // Act
    const result = parseLabels(undefined);

    // Assert
    expect(result).toEqual({});
  });

  it.each([
    ['a line without an equals sign', 'team'],
    ['a key with a space', 'my team=web'],
    ['an empty key', '=web'],
    ['a key that two lines set', 'team=a\nteam=b'],
    ['a value of 201 characters', `team=${'x'.repeat(201)}`],
    ['21 labels', Array.from({ length: 21 }, (_, i) => `k${i}=v`).join('\n')],
  ])('refuses %s', (_label, value) => {
    // Act
    const parse = () => parseLabels(value);

    // Assert
    expect(parse).toThrow(/^labels:/);
  });
});
