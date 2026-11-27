-- One row for each source file, suite and commit.
-- The tables store covered and total counts and never percents, so that sums over files and folders stay correct.
CREATE TABLE coverage_files (
  sha TEXT NOT NULL CHECK (length(sha) IN (40, 64)),
  date TEXT NOT NULL,
  suite TEXT NOT NULL,
  file TEXT NOT NULL,
  lines_covered INTEGER NOT NULL CHECK (typeof(lines_covered) = 'integer' AND lines_covered >= 0),
  lines_total INTEGER NOT NULL CHECK (typeof(lines_total) = 'integer' AND lines_total >= lines_covered),
  statements_covered INTEGER NOT NULL CHECK (typeof(statements_covered) = 'integer' AND statements_covered >= 0),
  statements_total INTEGER NOT NULL CHECK (typeof(statements_total) = 'integer' AND statements_total >= statements_covered),
  functions_covered INTEGER NOT NULL CHECK (typeof(functions_covered) = 'integer' AND functions_covered >= 0),
  functions_total INTEGER NOT NULL CHECK (typeof(functions_total) = 'integer' AND functions_total >= functions_covered),
  branches_covered INTEGER NOT NULL CHECK (typeof(branches_covered) = 'integer' AND branches_covered >= 0),
  branches_total INTEGER NOT NULL CHECK (typeof(branches_total) = 'integer' AND branches_total >= branches_covered),
  PRIMARY KEY (sha, suite, file)
) WITHOUT ROWID;

-- One row for each folder in the subtree of each file, so `src` overlaps `src/main`. The root `.` holds every file.
-- A panel must filter on one folder, or on the direct children of one folder.
CREATE TABLE coverage_folder_summary (
  sha TEXT NOT NULL CHECK (length(sha) IN (40, 64)),
  date TEXT NOT NULL,
  suite TEXT NOT NULL,
  folder TEXT NOT NULL,
  lines_covered INTEGER NOT NULL,
  lines_total INTEGER NOT NULL,
  statements_covered INTEGER NOT NULL,
  statements_total INTEGER NOT NULL,
  functions_covered INTEGER NOT NULL,
  functions_total INTEGER NOT NULL,
  branches_covered INTEGER NOT NULL,
  branches_total INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  PRIMARY KEY (sha, suite, folder)
) WITHOUT ROWID;

CREATE INDEX coverage_folder_summary_folder_suite_date ON coverage_folder_summary (folder, suite, date);

-- One row for each test suite and commit, from the same run as the coverage tables.
CREATE TABLE coverage_tests (
  sha TEXT NOT NULL CHECK (length(sha) IN (40, 64)),
  date TEXT NOT NULL,
  suite TEXT NOT NULL,
  files INTEGER NOT NULL CHECK (typeof(files) = 'integer' AND files >= 0),
  tests INTEGER NOT NULL CHECK (typeof(tests) = 'integer' AND tests = passed + failed + skipped),
  passed INTEGER NOT NULL CHECK (typeof(passed) = 'integer' AND passed >= 0),
  failed INTEGER NOT NULL CHECK (typeof(failed) = 'integer' AND failed >= 0),
  skipped INTEGER NOT NULL CHECK (typeof(skipped) = 'integer' AND skipped >= 0),
  PRIMARY KEY (sha, suite)
) WITHOUT ROWID;

CREATE INDEX coverage_tests_suite_date ON coverage_tests (suite, date);
