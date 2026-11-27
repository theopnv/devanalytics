import { ValidationError } from '../../core/contract.ts';
import type { CommitSnapshot, Metric } from '../../core/contract.ts';
import { expectDate, expectInteger, expectList, expectObject, expectSha, expectText } from '../../core/worker/expect.ts';

export const MAX_FILES = 5000;
export const MAX_SUITES = 20;
/** The name of a suite in the tables, the inputs and the badge URL. */
export const SUITE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** The suite with the union of all reports, or the only report. */
export const TOTAL = 'total';

export const COUNTED = ['lines', 'statements', 'functions', 'branches'] as const;
export type Counted = (typeof COUNTED)[number];

export type Pair = readonly [covered: number, total: number];

export type Counts = Record<Counted, Pair>;

export interface FileCoverage extends Counts {
  file: string;
}

export const TEST_COUNTS = ['files', 'tests', 'passed', 'failed', 'skipped'] as const;

export type TestCounts = Record<(typeof TEST_COUNTS)[number], number>;

export interface CoverageSnapshot extends CommitSnapshot {
  suites: Record<string, FileCoverage[]>;
  /** The test counts of each suite. Absent when the user gives no `test-results`. */
  tests?: Record<string, TestCounts>;
}

function parsePair(value: unknown, field: string): Pair {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new ValidationError(`${field} must be a pair of covered and total`);
  }
  return [expectInteger(value[0], `${field}[0]`), expectInteger(value[1], `${field}[1]`)];
}

function parseFile(value: unknown, field: string): FileCoverage {
  const entry = expectObject(value, field);
  return {
    file: expectText(entry['file'], `${field}.file`),
    lines: parsePair(entry['lines'], `${field}.lines`),
    statements: parsePair(entry['statements'], `${field}.statements`),
    functions: parsePair(entry['functions'], `${field}.functions`),
    branches: parsePair(entry['branches'], `${field}.branches`),
  };
}

function parseTestCounts(value: unknown, field: string): TestCounts {
  const entry = expectObject(value, field);
  return Object.fromEntries(TEST_COUNTS.map((name) => [name, expectInteger(entry[name], `${field}.${name}`)])) as TestCounts;
}

function parseNamed<T>(value: unknown, field: string, parseEntry: (entry: unknown, name: string) => T): Record<string, T> {
  const named = expectObject(value, field);
  const names = Object.keys(named);
  if (names.length === 0 || names.length > MAX_SUITES) {
    throw new ValidationError(`${field} must have 1 to ${MAX_SUITES} suites`);
  }
  for (const name of names) {
    if (!SUITE_NAME.test(name)) {
      throw new ValidationError(`${field}.${name}: a suite name uses letters, digits, ".", "_" and "-", and has 64 characters at most`);
    }
  }
  return Object.fromEntries(names.map((name) => [name, parseEntry(named[name], name)]));
}

export const metric: Metric<CoverageSnapshot> = {
  name: 'coverage',
  key: 'commit',
  parse(body) {
    const snapshot = expectObject(body, 'snapshot');
    const suites = parseNamed(snapshot['suites'], 'suites', (files, name) =>
      expectList(files, `suites.${name}`, MAX_FILES).map((file, index) => parseFile(file, `suites.${name}[${index}]`)));
    if (!(TOTAL in suites)) {
      throw new ValidationError(`suites must have a "${TOTAL}" suite`);
    }
    const tests = snapshot['tests'] === undefined
      ? undefined
      : parseNamed(snapshot['tests'], 'tests', (counts, name) => parseTestCounts(counts, `tests.${name}`));
    return {
      sha: expectSha(snapshot['sha']),
      date: expectDate(snapshot['date']),
      suites,
      ...(tests && { tests }),
    };
  },
};
