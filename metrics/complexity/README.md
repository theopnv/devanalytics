# complexity

Measures the cognitive and cyclomatic complexity of every function in a commit. The Worker also keeps a summary for each folder.

## Snapshot

| Field | Type | Meaning |
|---|---|---|
| `sha` | string | Commit sha. 40 or 64 hex characters. |
| `date` | string | Commit date in ISO 8601. The Worker stores it in UTC. |
| `cognitive_limit` | integer | The cognitive limit that the collector used. |
| `cyclomatic_limit` | integer | The cyclomatic limit that the collector used. |
| `functions` | array | At most 50000 objects: `file`, `qualified_name`, `line`, `cyclomatic`, `cognitive` and `is_test`. |

`file` is relative to `working-directory`. `qualified_name` shows the nesting, for example `River > useEffect#2`. The first function at a path has no suffix, so a new sibling does not rename the old ones.

The cognitive rule skips a function that scores 0. The collector stores it with `cognitive` 0.

## Tables

- `complexity_functions`: one row for each function.
- `complexity_folder_summary`: one row for each folder and test flag. A function counts in every folder above it, and in the root `.`. The `*_above` columns and `above_limits` use the limits of the snapshot. A score equal to the limit is not above it.

Filter a panel on one folder, or on the direct children of one folder, because the folders overlap.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `include` | `src/**/*.{ts,tsx,js,jsx}` | Globs of the files to measure, one on each line. |
| `exclude` | none | Globs of the files to skip, one on each line. Files in `node_modules` are always skipped. |
| `test-pattern` | `**/*.test.*` | Globs of the test files, one on each line. The summaries keep test functions apart. |
| `cognitive-limit` | `15` | A function above this score counts as above the limit. |
| `cyclomatic-limit` | `10` | A function above this score counts as above the limit. |

All globs are relative to `working-directory`. A comment such as `// eslint-disable` does not hide a function.

## Rows for each ingest

- One row for each function.
- One row for each folder and test flag. A function in `src/main/feed/a.ts` adds to `.`, `src`, `src/main` and `src/main/feed`.

For 1000 functions in 40 folders, an ingest writes about 1000 + 80 rows. Replacing an older ingest of the same commit also counts the deleted rows.

## Backfill

`backfill: 'commits'`. Use `--tags`, `--every <n>` or `--refs`. The collector measures each commit in a temporary worktree.

## Dashboard

`dashboard.json` is a Grafana export. Import it as described in `docs/setup-grafana.md`.

- **Inputs of the import:** the data source, `WORKER_URL` and `REPO_URL`. The data links use `REPO_URL`.
- **Variable:** `folder`. It lists the folders of the newest snapshot. The root `.` is the default.
- **Panels:** the sums of the newest snapshot, complexity over time, debt over time, the direct children of the folder, and the 20 most complex functions with a link to the code at the commit.

## Workflow step

```yaml
- uses: actions/checkout@v4
- uses: <owner>/devanalytics/action@v1
  with:
    metric: complexity
    worker-url: ${{ vars.DEVANALYTICS_URL }}
    token: ${{ secrets.DEVANALYTICS_INGEST_TOKEN }}
    include: |
      src/**/*.{ts,tsx}
    cognitive-limit: 15
    cyclomatic-limit: 10
```
