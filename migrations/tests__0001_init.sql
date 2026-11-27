-- One row for each test suite and runner of a CI run attempt. A flaky test passed on a retry, so `flaky` is part of `passed`.
-- `runner` is the name of the artifact folder, for example `ubuntu-latest`.
CREATE TABLE tests_suites (
  run_id INTEGER NOT NULL CHECK (typeof(run_id) = 'integer' AND run_id > 0),
  run_attempt INTEGER NOT NULL CHECK (typeof(run_attempt) = 'integer' AND run_attempt > 0),
  date TEXT NOT NULL,
  suite TEXT NOT NULL,
  runner TEXT NOT NULL,
  tests INTEGER NOT NULL CHECK (typeof(tests) = 'integer' AND tests = passed + failed + skipped),
  passed INTEGER NOT NULL CHECK (typeof(passed) = 'integer' AND passed >= 0),
  failed INTEGER NOT NULL CHECK (typeof(failed) = 'integer' AND failed >= 0),
  skipped INTEGER NOT NULL CHECK (typeof(skipped) = 'integer' AND skipped >= 0),
  flaky INTEGER NOT NULL CHECK (typeof(flaky) = 'integer' AND flaky >= 0 AND flaky <= passed),
  PRIMARY KEY (run_id, run_attempt, suite, runner)
) WITHOUT ROWID;

CREATE INDEX tests_suites_suite_date ON tests_suites (suite, date);

-- One row for each test that failed or needed a retry. A run without such a test writes no row here.
-- `position` keeps two tests with the same title apart.
CREATE TABLE tests_exceptions (
  run_id INTEGER NOT NULL CHECK (typeof(run_id) = 'integer' AND run_id > 0),
  run_attempt INTEGER NOT NULL CHECK (typeof(run_attempt) = 'integer' AND run_attempt > 0),
  date TEXT NOT NULL,
  suite TEXT NOT NULL,
  runner TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 0),
  file TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('failed', 'flaky')),
  retries INTEGER NOT NULL CHECK (typeof(retries) = 'integer' AND retries >= 0),
  error TEXT NOT NULL,
  PRIMARY KEY (run_id, run_attempt, suite, runner, position)
) WITHOUT ROWID;

CREATE INDEX tests_exceptions_status_date ON tests_exceptions (status, date);
