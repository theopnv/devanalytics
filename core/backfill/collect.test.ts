import { expect, test } from 'vitest';
import { snapshotId } from './collect.ts';

const SHA = 'a'.repeat(40);

test('names a snapshot of a commit by its sha', () => {
  expect(snapshotId({ sha: SHA, date: '2026-01-01T00:00:00Z' })).toBe(SHA);
});

test('names a snapshot of a run by its run and attempt, also when it has a sha', () => {
  expect(snapshotId({ run_id: 77, run_attempt: 2, date: '2026-01-01T00:00:00Z' })).toBe('77-2');
  expect(snapshotId({ run_id: 77, run_attempt: 2, date: '2026-01-01T00:00:00Z', sha: SHA } as never)).toBe('77-2');
});
