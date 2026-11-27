import { describe, expect, test } from 'vitest';
import { parseBackfillArgs, UsageError } from './args.ts';

describe('parseBackfillArgs', () => {
  test('reads the options and applies the defaults', () => {
    expect(parseBackfillArgs(['--metric', 'coverage', '--repo', '../app', '--tags'])).toEqual({
      metric: 'coverage', repo: '../app', selection: { kind: 'tags' }, since: undefined, branch: undefined, command: undefined,
      inputs: {}, dryRun: false, dir: '.backfill', workerUrl: undefined,
    });
  });

  test('reads every option', () => {
    const options = parseBackfillArgs([
      '--metric', 'coverage', '--repo', '../app', '--every', '5', '--branch', 'trunk', '--since', '2026-01-31',
      '--run', 'npm ci && npm test', '--input', 'reports=unit=a.json', '--input', 'x=', '--dir', 'cache', '--worker-url', 'https://w.example', '--dry-run',
    ]);

    expect(options).toMatchObject({
      selection: { kind: 'every', step: 5 }, branch: 'trunk', command: 'npm ci && npm test', dryRun: true, dir: 'cache', workerUrl: 'https://w.example',
      inputs: { reports: 'unit=a.json', x: '' },
    });
    expect(options.since?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  test('splits --refs at the commas', () => {
    expect(parseBackfillArgs(['--metric', 'm', '--refs', 'a, b,c']).selection).toEqual({ kind: 'refs', refs: ['a', 'b', 'c'] });
  });

  test.each([
    ['no metric', [], 'Set --metric'],
    ['two selections', ['--metric', 'm', '--tags', '--every', '2'], 'Use one of --tags, --every and --refs. You gave --tags and --every.'],
    ['an every that is not a number', ['--metric', 'm', '--every', 'x'], '--every must be a whole number'],
    ['an every of zero', ['--metric', 'm', '--every', '0'], '--every must be a whole number'],
    ['an empty refs', ['--metric', 'm', '--refs', ','], '--refs needs at least one ref'],
    ['a since that is not a date', ['--metric', 'm', '--since', 'last week'], 'is not a date'],
    ['an input without a name', ['--metric', 'm', '--input', '=x'], 'must look like name=value'],
    ['an option that does not exist', ['--metric', 'm', '--nope'], 'nope'],
  ])('refuses %s', (_label, argv, message) => {
    expect(() => parseBackfillArgs(argv)).toThrow(UsageError);
    expect(() => parseBackfillArgs(argv)).toThrow(message);
  });
});
