# Architecture

Devanalytics has a small core and a set of metrics. A metric is one folder in `metrics/`. The core gives each metric a Worker route, an Action input and a backfill command. The metric gives the core its data model.

This page shows the contract between the core and a metric, the four flows of the product, and the steps to add, change and remove a metric.

## The metric contract

A metric has three parts. Each part is a file in `metrics/<name>/`.

- `metric.ts` holds the snapshot type and the validation. The Worker and the Action both import it. It does no I/O.
- `store.ts` runs in the Worker. It turns a snapshot into table rows.
- `collect.ts` runs in the Action and in the backfill command. It reads the repository and makes a snapshot.

```mermaid
classDiagram
  class Metric~S~ {
    +name string
    +key commit or run
    +parse(body) S
  }
  class Store~S~ {
    +tables string[]
    +toRows(s) TableRows[]
    +badge(db, params) ShieldsEndpoint
  }
  class Collector~S~ {
    +inputs InputSpec[]
    +backfill commits or runs
    +collect(ctx) S
  }
  class TableRows {
    +table string
    +insert string
    +rows unknown[][]
  }
  class InputSpec {
    +name string
    +description string
    +default string
  }
  class CollectContext {
    +inputs Record
    +cwd string
    +env Record
  }
  class Worker {
    router
    auth
    query guard
    replace by key
    write budget
  }
  class Action {
    input parsing
    upload with retry
    dispatch
  }
  class Backfill {
    list targets
    local cache
    upload to the budget
  }
  Store ..> Metric : snapshot type
  Collector ..> Metric : snapshot type
  Store --> TableRows : returns
  Collector --> InputSpec : declares
  Collector --> CollectContext : receives
  Worker --> Metric : validates with
  Worker --> Store : writes with
  Action --> Collector : runs
  Backfill --> Collector : runs
```

### What the core enforces

- **Key columns.** Each table of a `commit` metric has `sha` and `date`. Each table of a `run` metric has `run_id`, `run_attempt` and `date`. The core deletes and inserts rows by these columns, so `toRows` never deletes.
- **Dates.** `date` is the commit date or the run start time. It is never the upload time. A backfill then gives correct trends.
- **Table names.** Each table name starts with `<name>_`. The query route of a metric accepts only its own tables.
- **Write budget.** An ingest that would pass the daily row limit gets a `429`.

### What `npm run sync` does

`npm run sync` reads `metrics/*/` and writes three things:

- `src/generated/worker-registry.ts`. It imports `metric.ts` and `store.ts` of each metric.
- `action/src/generated/collector-registry.ts`. It imports `metric.ts` and `collect.ts` of each metric.
- `migrations/`. It holds the core migrations and a copy of each metric migration, named `<name>__<file>`. Wrangler applies the files in name order and records each name.

The generated files are in git. CI fails when `npm run sync` changes them.

## The four flows

### 1. Setup

You do this once.

```mermaid
sequenceDiagram
  actor Owner
  participant Fork as Your fork of the template
  participant CF as Cloudflare
  participant App as Your app repository
  participant GF as Grafana Cloud
  Owner->>Fork: fork the template
  Owner->>CF: deploy the Worker (Worker and D1 are created)
  Owner->>CF: npm run migrate:remote (tables are created)
  Owner->>CF: wrangler secret put INGEST_TOKEN and QUERY_TOKEN
  Owner->>App: add the secret DEVANALYTICS_INGEST_TOKEN
  Owner->>App: add the variable DEVANALYTICS_URL
  Owner->>App: copy commit.yml and runs.yml from examples/workflows
  Owner->>App: add the badge to README.md
  Owner->>GF: install the Infinity plugin
  Owner->>GF: add the data source with QUERY_TOKEN
  Owner->>GF: import metrics/*/dashboard.json
  opt old history
    Owner->>Fork: npm run backfill (one time, over several days if needed)
  end
```

### 2. Every day

The workflows in your repository send the data. The Worker never reads your code. It only receives JSON snapshots.

```mermaid
sequenceDiagram
  participant Push as Push to the default branch
  participant Commit as commit.yml
  participant Tests as Your test workflow
  participant Runs as runs.yml
  participant W as Worker
  participant D1
  Push->>Commit: start
  Commit->>Commit: checkout, install, run your tests
  Commit->>W: POST /v1/complexity/ingest
  Commit->>W: POST /v1/coverage/ingest
  Tests->>Tests: upload the test reports as artifacts
  Tests->>Runs: the run completes (workflow_run)
  Runs->>Runs: download the artifacts of the run
  Runs->>W: POST /v1/ci/ingest
  Runs->>W: POST /v1/tests/ingest
  W->>W: check INGEST_TOKEN, parse with Metric.parse
  W->>D1: read the usage of the day and count the rows to replace
  W->>W: refuse with 429 if the budget is not enough
  W->>D1: delete the rows of the key, insert the new rows, count the usage
  W-->>Commit: 200 with rowsWritten
```

- A `commit` metric runs on a push to the default branch. A second push of the same sha replaces its rows.
- A `run` metric runs after each run of the workflows that you list in `runs.yml`, on any branch. A re-run attempt is a new key.
- An upload that fails fails only its own workflow. It never fails your tests or your releases.

### 3. Reading

```mermaid
sequenceDiagram
  participant Panel as Grafana panel
  participant Shields as shields.io
  actor Owner
  participant W as Worker
  participant D1
  Panel->>W: POST /v1/metric/query with sql, params and QUERY_TOKEN
  W->>W: check the token and the allow list of tables
  W->>D1: SELECT
  W-->>Panel: rows, truncated, meta (Grafana caches it for 1 hour)
  Shields->>W: GET /v1/coverage/badge, no token
  W->>D1: one fixed query
  W-->>Shields: label, message, color (cached for 1 hour)
  Owner->>W: GET /v1/usage with QUERY_TOKEN
  W-->>Owner: day, rowsWritten, limit, backfillLimit
```

### 4. Backfill

You do this once, on your machine, from your fork of the template.

```mermaid
sequenceDiagram
  actor Owner
  participant CLI as npm run backfill
  participant Repo as Your repository
  participant Cache as .backfill folder
  participant W as Worker
  Owner->>CLI: --metric coverage --repo ../my-app --tags --run "..."
  CLI->>Repo: list the targets (tags, every n commits, or runs of the last 90 days)
  loop each target
    CLI->>Cache: skip it if the snapshot is in the cache
    CLI->>Repo: worktree, run the command, collect
    CLI->>Cache: write the snapshot
  end
  loop each snapshot in date order
    CLI->>W: POST ingest with X-Devanalytics-Mode: backfill
    alt 200
      CLI->>Cache: record the key in state.json
    else 429
      CLI-->>Owner: stop, and say when the next run can start
    end
  end
  Owner->>CLI: run the same command on the next day, and it resumes
```

## Add a metric

1. Make the folder `metrics/<name>/`. The name uses lowercase letters and digits only. It is also the URL segment and the table prefix.
2. Write `metric.ts`, `store.ts` and `collect.ts` as in the contract above.
3. Write `migrations/0001_init.sql`. Each table starts with `<name>_` and has the key columns of the metric.
4. Add `fixtures/snapshot.json`, the tests, `README.md` and, if you want a view, `dashboard.json`.
5. Run `npm run sync`. It updates the registries and `migrations/`.
6. Run `npm run build:action`, `npm run typecheck`, `npm run lint` and `npm test`. Then run `npm run smoke -- <name>`.
7. Commit the folder and the generated files.
8. Apply the change to your deployment: `npm run migrate:remote`, then `npm run deploy`.

`docs/write-a-metric.md` shows these steps on an example.

## Change a metric

- **A change to the validation or the collector.** Edit the files and run the checks. Old rows stay as they are.
- **A change to the tables.** Never edit a migration that is applied. Add a new file, such as `0002_add_column.sql`, in `metrics/<name>/migrations/`. Run `npm run sync`, `npm run migrate:remote` and `npm run deploy`, in this order.
- **A change to a dashboard.** Edit `dashboard.json` and import it again. The `uid` of the dashboard stays the same, so Grafana replaces the old version.

## Remove a metric

1. Delete the folder `metrics/<name>/`.
2. Run `npm run sync` and `npm run build:action`. The registries and `migrations/` lose the metric.
3. Run `npm run deploy`. The routes of the metric are gone.
4. Remove the workflow step in your repository.

The tables and the rows stay in D1. To free the space, drop the tables of the metric:

```
npx wrangler d1 execute DB --remote --command "DROP TABLE <name>_<table>"
```

Do this only if you never add the metric again. Wrangler records each migration as applied, so it does not create the tables a second time.
