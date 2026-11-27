# coverage

Stores the coverage of each source file, suite and folder for each commit. It can also store the test counts of each suite.

## Snapshot

| Field | Type | Meaning |
|---|---|---|
| `sha` | string | Commit sha. 40 or 64 hex characters. |
| `date` | string | Commit date in ISO 8601. The Worker stores it in UTC. |
| `suites` | object | 1 to 20 suites. The key is the suite name. The value is an array of at most 5000 files. A `total` suite is required. |
| `tests` | object | Optional. The key is a suite name. The value has `files`, `tests`, `passed`, `failed` and `skipped`. |

A file has `file` (relative to `working-directory`) and four pairs: `lines`, `statements`, `functions` and `branches`. A pair is `[covered, total]`. The tables keep counts and never percents, so sums over files and folders stay correct.

A suite name uses letters, digits, `.`, `_` and `-`, and has at most 64 characters.

## Suites

- With one report, the collector stores it as `total` only. No row is duplicated.
- With two or more reports, each report is a suite, and the collector adds `total`, the union of all reports.
  - Istanbul reports: the maps are merged. A statement at the same location counts once.
  - lcov reports: the reports are merged line by line, function by function and branch by branch.
  - The reports must all be Istanbul JSON, or all be lcov. The collector refuses a mix.
- A report cannot be named `total` when there are two or more reports.

An lcov file has no statements. The `statements` pair repeats the `lines` pair.

## Tables

- `coverage_files`: one row for each file and suite.
- `coverage_folder_summary`: one row for each folder and suite. A file counts in every folder above it, and in the root `.`.
- `coverage_tests`: one row for each test suite. It is empty when the snapshot has no `tests`.

Filter a panel on one folder, or on the direct children of one folder, because the folders overlap.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `reports` | none | One coverage report on each line, as `suite=path`. The file is an Istanbul `coverage-final.json` or an `lcov.info`. The content gives the format. |
| `test-results` | none | Optional. One test report on each line, as `suite=path`. The file is a Vitest JSON, a Playwright JSON or a JUnit XML. A flaky Playwright test counts as passed. For JUnit, `files` counts the distinct `file` or `classname` values. |

All paths are relative to `working-directory`. The collector keeps only files inside it, and skips `node_modules`.

## Badge

`GET /v1/coverage/badge?suite=total&folder=.` shows the line coverage of one folder and one suite in the newest snapshot. The defaults are `total` and `.`. The route needs no token. It validates both parameters and binds them to one fixed query.

Colors: 80% and more is green, 60% and more is orange, and less is red.

## Rows for each ingest

- One row for each file and suite.
- One row for each folder and suite. A file in `src/main/feed/a.ts` adds to `.`, `src`, `src/main` and `src/main/feed`.
- One row for each test suite.

With 300 files in 30 folders and two suites (`unit` and `total`), an ingest writes about 600 + 60 rows. Replacing an older ingest of the same commit also counts the deleted rows. The cost grows with the number of suites, so a repository with a large source tree can use one report.

## Backfill

`backfill: 'commits'`. Use `--tags`, `--every <n>` or `--refs`. Old commits have no coverage report, so give `--run` a command that makes the reports, for example `--run "npm ci && npx vitest run --coverage"`. The `reports` input names the files that the command writes: `--input reports=unit=coverage/lcov.info`. An input that is repeated keeps its last value, so for two reports use one value with a new line between them, for example `--input $'reports=unit=a.info\ne2e=b.info'` in a POSIX shell.

## Dashboard

`dashboard.json` is a Grafana export. Import it as described in `docs/setup-grafana.md`.

- **Inputs of the import:** the data source, `WORKER_URL` and `REPO_URL`. The data links use `REPO_URL`.
- **Variables:** `folder` and `suite`. The defaults are the root `.` and `total`.
- **Panels:** the coverage of the newest snapshot, line coverage over time for each suite, line coverage by suite, the direct children of the folder, the 20 files with the most uncovered lines, and the test counts. The test panels are empty when the `test-results` input is not set.

## Workflow step

```yaml
- uses: actions/checkout@v4
- run: npx vitest run --coverage --coverage.reporter=lcov
- uses: <owner>/devanalytics/action@v1
  with:
    metric: coverage
    worker-url: ${{ vars.DEVANALYTICS_URL }}
    token: ${{ secrets.DEVANALYTICS_INGEST_TOKEN }}
    reports: |
      unit=coverage/lcov.info
    test-results: |
      unit=test-results/vitest.json
```
