# tests

Stores the result of each CI run: the counts for each test suite and runner, and the tests that failed or passed on a retry.

## Snapshot

| Field | Type | Meaning |
|---|---|---|
| `run_id` | integer | The workflow run, 1 or more. |
| `run_attempt` | integer | The attempt of the run, 1 or more. |
| `date` | string | The start of the run attempt in ISO 8601. The Worker stores it in UTC. It is never the upload time. |
| `suites` | array | At most 50 objects: `suite`, `runner`, `tests`, `passed`, `failed`, `skipped` and `flaky`. `tests` equals `passed + failed + skipped`. A flaky test passed on a retry, so `flaky` is part of `passed`. |
| `exceptions` | array | At most 1000 objects: `suite`, `runner`, `file`, `title`, `status` (`failed` or `flaky`), `retries` and `error` (the first line of the message, 300 characters at most). |

## Tables

- `tests_suites`: one row for each suite and runner.
- `tests_exceptions`: one row for each test that failed or needed a retry. A run without such a test writes no row.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `reports` | none | One test report on each line, as `suite=path`. |
| `run-id` | the `workflow_run` event, or the current run | The run to record. |
| `run-attempt` | the same place as `run-id` | The attempt to record. |
| `run-started-at` | the event, or GitHub | The start of the run in ISO 8601. |
| `github-token` | none | A token with `actions: read`. It reads the start of the run when no other source has it. When `working-directory` has no subfolder, it also downloads the artifacts of the run into it. |

`working-directory` is the artifact folder. It has one subfolder for each runner, and the name of the subfolder is the `runner` of the rows. `actions/download-artifact` makes this layout when each runner uploads an artifact with its own name. The path in `reports` is relative to each runner subfolder. A runner without the file did not run the suite.

A report is one of these formats. The content gives the format.

- **JUnit XML.** A test case with `failure` or `error` failed. A test case with `skipped` was skipped. A test case with `flakyFailure` passed on a retry. The `file` of a test is its `file`, its `classname`, or the name of its suite.
- **Vitest JSON.** Either the `json` reporter of Vitest, which has no retry data, or the file of `action/reporters/vitest.mjs`, which says which test passed on a retry.
- **Playwright JSON.** The `json` reporter. The `file` is relative to the test folder of Playwright.

A report that cannot be read gives a warning and no rows, so one broken report does not stop the other suites. A report larger than 50 MB is skipped. When no report is found, the collector warns and sends a snapshot with no rows. A run that skipped its tests, such as a documentation change, does not fail the workflow.

## Flaky tests with Vitest

Copy `action/reporters/vitest.mjs` into your repository, add it to the Vitest command and set the output file:

```
DEVANALYTICS_VITEST_REPORT=reports/unit.json npx vitest run --reporter=default --reporter=./scripts/devanalytics-vitest.mjs
```

The reporter does nothing when `DEVANALYTICS_VITEST_REPORT` is not set. Set `retry` in the Vitest config, because Vitest reports a flaky test only after a retry.

## Rows for each ingest

One row for each suite and runner, and one row for each exception. A run with 3 suites on 3 runners and 5 exceptions writes about 14 rows. Replacing an older ingest of the same attempt also counts the deleted rows.

## Backfill

`backfill: 'runs'`. Use `--repo <owner/name> --since <date>` with `GITHUB_TOKEN`. For each run, the collector downloads the artifacts of the run and reads them as above. GitHub keeps artifacts for 90 days by default, so older runs cannot be collected. Pass the `reports` input with `--input`. For two reports, use one value with a new line between them, for example `--input $'reports=unit=unit.json\ne2e=e2e.json'` in a POSIX shell.

## Workflow step

Use a `workflow_run` workflow, so that a pull request cannot read the token.

```yaml
- uses: actions/download-artifact@v4
  with:
    run-id: ${{ github.event.workflow_run.id }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    path: reports
- uses: <owner>/devanalytics@v1
  with:
    metric: tests
    worker-url: ${{ vars.DEVANALYTICS_URL }}
    token: ${{ secrets.DEVANALYTICS_INGEST_TOKEN }}
    working-directory: reports
    reports: |
      unit=unit.json
      e2e=e2e.json
```
