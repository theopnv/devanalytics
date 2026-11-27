# ci

Stores the timing of each CI run: the run, its jobs, their steps, and the sections of each job log.

## Snapshot

| Field | Type | Meaning |
|---|---|---|
| `run_id` | integer | The workflow run, 1 or more. |
| `run_attempt` | integer | The attempt of the run, 1 or more. |
| `date` | string | The start of the run attempt in ISO 8601. The Worker stores it in UTC. It is never the upload time. |
| `sha` | string | The commit that the run tested. 40 or 64 hex characters. |
| `workflow` | string | The name of the workflow. Any text. |
| `event` | string | The event that started the run, for example `push`. |
| `branch` | string | The head branch, or `unknown`. |
| `conclusion` | string | The conclusion of the run, or `unknown`. |
| `wall_seconds` | integer | Seconds from the start of the attempt to its last update. |
| `labels` | object | Optional. At most 20 pairs. The key uses letters, digits, `.`, `_` and `-`. The value is text of at most 200 characters. |
| `jobs` | array | At most 256 jobs. Each has `id`, `name`, `runner`, `os`, `conclusion`, `queue_seconds`, `duration_seconds`, `steps` and `groups`. |

`runner` is the first `runs-on` label of the job. `os` is `linux`, `macos`, `windows` or `other`, from the runner label. `queue_seconds` and `duration_seconds` are `null` for a job that never started. A skipped step has no duration. A step lasts a whole number of seconds, so a fast step has 0.

A group is a `##[group]` section of the job log. It lasts until the next group starts. Groups shorter than one second are dropped, and at most 200 are kept. This splits a composite action into its steps. The name of a group has the commit sha of an action removed, so a version bump does not start a new series.

## Tables

- `ci_runs`: one row for each run attempt. The `labels` column holds the labels as JSON text, or `NULL`. Read one label with `labels ->> 'team'`.
- `ci_jobs`: one row for each job.
- `ci_steps`: one row for each step of each job.
- `ci_step_groups`: one row for each log group of each job.

Percentiles of `wall_seconds` and of job times only make sense on rows with `conclusion = 'success'`.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `run-id` | the `workflow_run` event, or the current run | The run to record. |
| `run-attempt` | the same place as `run-id` | The attempt to record. |
| `github-token` | none | A token with `actions: read`. It reads the run, its jobs and their logs. The collector fails when it is empty. |
| `labels` | none | One `key=value` pair on each line. |

A job log that cannot be read gives a warning and no groups. The rest of the run is still stored.

## Rows for each ingest

One row for the run, one row for each job, one row for each step, and one row for each log group. A run with 4 jobs, 12 steps each and 8 groups each writes about 1 + 4 + 48 + 32 rows. Replacing an older ingest of the same attempt also counts the deleted rows.

## Backfill

`backfill: 'runs'`. Use `--repo <owner/name> --since <date>` with `GITHUB_TOKEN`. GitHub keeps logs for 90 days by default, so older runs cannot be collected. GitHub lists only the newest attempt of each run. Pass `labels` with `--input` if you want labels on old runs.

## Workflow step

Use a `workflow_run` workflow, so that the run is finished and a pull request cannot read the token.

```yaml
on:
  workflow_run:
    workflows: [Test]
    types: [completed]

permissions:
  actions: read

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: <owner>/devanalytics@v1
        with:
          metric: ci
          worker-url: ${{ vars.DEVANALYTICS_URL }}
          token: ${{ secrets.DEVANALYTICS_INGEST_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          labels: |
            team=web
```
