# bundlesize

An example metric. It stores the size of each file of a build output, for each commit. `docs/write-a-metric.md` builds it step by step.

It is not active. To use it, copy this folder to `metrics/bundlesize/` and run `npm run sync`. The folder name of an active metric uses lowercase letters and digits only, so the hyphen goes away.

## Snapshot

| Field | Type | Meaning |
|---|---|---|
| `sha` | string | Commit sha. 40 or 64 hex characters. |
| `date` | string | Commit date in ISO 8601. |
| `files` | array | At most 2000 objects: `path` (relative to the build folder), `bytes` and `gzip_bytes` (integers of 0 or more). |

## Tables

- `bundlesize_files`: one row for each file.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `dir` | `dist` | The folder that holds the build output, relative to `working-directory`. |

## Rows for each ingest

One row for each file. A build with 40 files writes about 41 rows. Replacing an older ingest of the same commit also counts the deleted rows.

## Backfill

`backfill: 'commits'`. Use `--run` to build each commit, for example `--run "npm ci && npm run build"`.

## Workflow step

```yaml
- uses: actions/checkout@v4
- run: npm ci && npm run build
- uses: <owner>/devanalytics/action@v1
  with:
    metric: bundlesize
    worker-url: ${{ vars.DEVANALYTICS_URL }}
    token: ${{ secrets.DEVANALYTICS_INGEST_TOKEN }}
    dir: dist
```
