import type { Store } from '../../core/contract.ts';
import type { TestsSnapshot } from './metric.ts';

const INSERT_SUITES = `
INSERT INTO tests_suites (run_id, run_attempt, date, suite, runner, tests, passed, failed, skipped, flaky)
SELECT ?1, ?2, ?3, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, value ->> 6
FROM json_each(?4)`;

const INSERT_EXCEPTIONS = `
INSERT INTO tests_exceptions (run_id, run_attempt, date, suite, runner, position, file, title, status, retries, error)
SELECT ?1, ?2, ?3, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, value ->> 6, value ->> 7
FROM json_each(?4)`;

export const store: Store<TestsSnapshot> = {
  tables: ['tests_suites', 'tests_exceptions'],
  toRows({ suites, exceptions }) {
    return [
      {
        table: 'tests_suites',
        insert: INSERT_SUITES,
        rows: suites.map((s) => [s.suite, s.runner, s.tests, s.passed, s.failed, s.skipped, s.flaky]),
      },
      {
        table: 'tests_exceptions',
        insert: INSERT_EXCEPTIONS,
        rows: exceptions.map((e, position) => [e.suite, e.runner, position, e.file, e.title, e.status, e.retries, e.error]),
      },
    ];
  },
};
