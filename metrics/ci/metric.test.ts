import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../core/contract.ts';
import { metric } from './metric.ts';
import { store } from './store.ts';
import snapshot from './fixtures/snapshot.json' with { type: 'json' };

describe('ci metric', () => {
  it('parses the fixture snapshot', () => {
    // Act
    const result = metric.parse(snapshot);

    // Assert
    expect(result).toEqual(snapshot);
  });

  it('accepts a snapshot without labels', () => {
    // Act
    const result = metric.parse({ ...snapshot, labels: undefined });

    // Assert
    expect(result).not.toHaveProperty('labels');
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
    ['a run id that is not an integer', { ...snapshot, run_id: 'x' }],
    ['a missing workflow', { ...snapshot, workflow: '' }],
    ['a wall time that is negative', { ...snapshot, wall_seconds: -1 }],
    ['jobs that are not an array', { ...snapshot, jobs: {} }],
    ['an unknown os', { ...snapshot, jobs: [{ ...snapshot.jobs[0], os: 'plan9' }] }],
    ['a step without a name', { ...snapshot, jobs: [{ ...snapshot.jobs[0], steps: [{ number: 1, conclusion: 'success', duration_seconds: 1 }] }] }],
    ['labels that are not an object', { ...snapshot, labels: 'team=web' }],
    ['a label key with a space', { ...snapshot, labels: { 'a b': 'x' } }],
    ['a label value that is not text', { ...snapshot, labels: { team: 3 } }],
    ['more than 20 labels', { ...snapshot, labels: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v'])) }],
  ])('refuses %s', (_label, body) => {
    // Act
    const parse = () => metric.parse(body);

    // Assert
    expect(parse).toThrow(ValidationError);
  });
});

describe('store', () => {
  it('gives the rows of each table, with the labels as JSON text and the log groups in order', () => {
    // Act
    const [runs, jobs, steps, groups] = store.toRows(metric.parse(snapshot));

    // Assert
    expect(runs?.rows).toEqual([[snapshot.sha, 'Test', 'pull_request', 'feature', 'success', 300, '{"team":"web"}']]);
    expect(jobs?.rows).toHaveLength(2);
    expect(steps?.rows).toEqual([[1, 2, 'Install dependencies', 'success', 14], [1, 3, 'Run tests', 'skipped', null]]);
    expect(groups?.rows).toEqual([[1, 0, 'Run npm ci', 134000]]);
    expect([runs, jobs, steps, groups].map((entry) => entry?.table)).toEqual(store.tables);
  });

  it('stores NULL when there are no labels', () => {
    // Act
    const [runs] = store.toRows(metric.parse({ ...snapshot, labels: undefined }));

    // Assert
    expect(runs?.rows[0]?.[6]).toBeNull();
  });
});
