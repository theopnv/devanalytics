import type { Metric, RunSnapshot } from '../../core/contract.ts';
import { expectDate, expectInteger, expectList, expectObject, expectOneOf, expectText } from '../../core/worker/expect.ts';

export const MAX_SUITES = 50;
export const MAX_EXCEPTIONS = 1000;
export const EXCEPTION_STATUSES = ['failed', 'flaky'] as const;

export interface SuiteRow {
  suite: string;
  runner: string;
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
  /** Passed on a retry, so part of `passed`. */
  flaky: number;
}

export interface ExceptionRow {
  suite: string;
  runner: string;
  file: string;
  title: string;
  status: (typeof EXCEPTION_STATUSES)[number];
  retries: number;
  error: string;
}

export interface TestsSnapshot extends RunSnapshot {
  suites: SuiteRow[];
  exceptions: ExceptionRow[];
}

function parseSuite(value: unknown, index: number): SuiteRow {
  const field = `suites[${index}]`;
  const row = expectObject(value, field);
  return {
    suite: expectText(row['suite'], `${field}.suite`),
    runner: expectText(row['runner'], `${field}.runner`),
    tests: expectInteger(row['tests'], `${field}.tests`),
    passed: expectInteger(row['passed'], `${field}.passed`),
    failed: expectInteger(row['failed'], `${field}.failed`),
    skipped: expectInteger(row['skipped'], `${field}.skipped`),
    flaky: expectInteger(row['flaky'], `${field}.flaky`),
  };
}

function parseException(value: unknown, index: number): ExceptionRow {
  const field = `exceptions[${index}]`;
  const row = expectObject(value, field);
  return {
    suite: expectText(row['suite'], `${field}.suite`),
    runner: expectText(row['runner'], `${field}.runner`),
    file: expectText(row['file'], `${field}.file`),
    title: expectText(row['title'], `${field}.title`),
    status: expectOneOf(row['status'], `${field}.status`, EXCEPTION_STATUSES),
    retries: expectInteger(row['retries'], `${field}.retries`),
    error: expectText(row['error'], `${field}.error`),
  };
}

export const metric: Metric<TestsSnapshot> = {
  name: 'tests',
  key: 'run',
  parse(body) {
    const snapshot = expectObject(body, 'snapshot');
    return {
      run_id: expectInteger(snapshot['run_id'], 'run_id'),
      run_attempt: expectInteger(snapshot['run_attempt'], 'run_attempt'),
      date: expectDate(snapshot['date']),
      suites: expectList(snapshot['suites'], 'suites', MAX_SUITES).map(parseSuite),
      exceptions: expectList(snapshot['exceptions'], 'exceptions', MAX_EXCEPTIONS).map(parseException),
    };
  },
};
