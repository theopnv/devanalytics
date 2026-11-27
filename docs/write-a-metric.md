# Write a metric

A metric is one folder in `metrics/`. This page builds a small metric, `bundlesize`, which stores the size of each file of your build output for each commit. The finished metric is in `examples/metrics/bundle-size/`. It is not active.

Read `docs/architecture.md` first. It shows the contract between the core and a metric.

## Use the finished example

If you only want to try it:

```
cp -r examples/metrics/bundle-size metrics/bundlesize
npm run sync
```

The names differ on purpose. The folder of an active metric uses lowercase letters and digits only, because the name is also the URL segment and the table prefix. The files of the example already use the final name `bundlesize`, and their imports are right for `metrics/bundlesize/`.

The rest of this page explains each file.

## 1. Choose the key

A metric stores one snapshot for each key. A new snapshot with the same key replaces the old rows.

- `commit`: one snapshot for each commit. Each table has the columns `sha` and `date`.
- `run`: one snapshot for each attempt of a workflow run. Each table has the columns `run_id`, `run_attempt` and `date`.

`bundlesize` uses `commit`. `date` is the date of the commit. It is never the date of the upload, so a backfill gives correct trends.

## 2. Write `metric.ts`

`metric.ts` has the type of the snapshot and `parse`. The Worker and the Action both use it, so it does no I/O.

```ts
export interface BundleFile {
  path: string;
  bytes: number;
  gzip_bytes: number;
}

export interface BundleSizeSnapshot extends CommitSnapshot {
  files: BundleFile[];
}

export const metric: Metric<BundleSizeSnapshot> = {
  name: 'bundlesize',
  key: 'commit',
  parse(body) {
    // Check each field. Throw a ValidationError with a clear message.
  },
};
```

`parse` gets the JSON that came over the network, so it checks every field and every limit. A `ValidationError` gives the caller a `400` answer with your message. Put a limit on each array, because the Worker must not read an unbounded body.

## 3. Write the migration

`migrations/0001_init.sql` makes the tables.

```sql
CREATE TABLE bundlesize_files (
  sha TEXT NOT NULL CHECK (length(sha) IN (40, 64)),
  date TEXT NOT NULL,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (typeof(bytes) = 'integer' AND bytes >= 0),
  gzip_bytes INTEGER NOT NULL CHECK (typeof(gzip_bytes) = 'integer' AND gzip_bytes >= 0),
  PRIMARY KEY (sha, path)
) WITHOUT ROWID;
```

- Each table name starts with `<name>_`. The query route of a metric accepts only the tables of the same metric.
- Each table has the key columns. The core deletes the old rows by these columns.
- Put the key columns first in the primary key. The rows of one commit are then close to each other.
- Store counts and not percents, so that a sum over many rows stays correct.

## 4. Write `store.ts`

`store.ts` lists the tables and turns a snapshot into rows.

```ts
const INSERT_FILES = `
INSERT INTO bundlesize_files (sha, date, path, bytes, gzip_bytes)
SELECT ?1, ?2, value ->> 0, value ->> 1, value ->> 2
FROM json_each(?3)`;

export const store: Store<BundleSizeSnapshot> = {
  tables: ['bundlesize_files'],
  toRows(snapshot) {
    return [{ table: 'bundlesize_files', insert: INSERT_FILES, rows: snapshot.files.map((file) => [file.path, file.bytes, file.gzip_bytes]) }];
  },
};
```

The insert gets the key columns first, then the `date`, and last a JSON array of rows. For a `commit` metric, the key is `?1` (`sha`), the date is `?2`, and the rows are `?3`. For a `run` metric, the key is `?1` (`run_id`) and `?2` (`run_attempt`), the date is `?3`, and the rows are `?4`. Each row is an array in the order of `->> 0`, `->> 1` and so on.

The core splits the rows into chunks, and it runs the delete and all inserts in one batch. If an insert fails, D1 keeps the old rows. `toRows` never deletes.

A store can also have a `badge` function for a public badge. Make the query fixed, validate each parameter, and bind it. See `metrics/coverage/store.ts`.

## 5. Write `collect.ts`

`collect.ts` runs in the Action and in the backfill command. It reads the repository and returns a snapshot.

```ts
export const collector: Collector<BundleSizeSnapshot> = {
  inputs: [{ name: 'dir', description: 'The folder that holds the build output.', default: 'dist' }],
  backfill: 'commits',
  async collect(ctx) {
    // Read the files under ctx.cwd and the input "dir". Return metric.parse({ ...headCommit(ctx.cwd), files }).
  },
};
```

- `inputs` become the `with:` entries of the Action. `npm run build:action` also writes them into `action/action.yml`.
- `ctx.cwd` is the folder to read. In a backfill, it is a temporary worktree of the old commit.
- `headCommit(ctx.cwd)` gives the `sha` and the `date` of the checked-out commit.
- `backfill: 'commits'` lets `npm run backfill` list old commits for the metric. Use `'runs'` for a metric that reads workflow runs.

## 6. Add fixtures and tests

- `fixtures/snapshot.json` is a valid snapshot. The dashboard test sends it to a local Worker.
- `fixtures/dist/` is a small input for the collector. `fixtures/inputs.json` has the values of the inputs: `{ "dir": "dist" }`.
- `bundle-size.test.ts` tests `parse`, `toRows` and `collect`. It runs in Node with Vitest.

Put a test next to each file. A test file that ends in `.worker.test.ts` runs in the Workers runtime with a local D1. Use this kind for a test that needs the tables, as in `metrics/coverage/coverage.worker.test.ts`.

## 7. Sync and check

```
npm run sync
npm run build:action
npm run typecheck
npm run lint
npm test
npm run smoke -- bundlesize
```

`npm run sync` writes the two registries and copies your migrations to `migrations/` as `bundlesize__0001_init.sql`. `npm run smoke` starts a local Worker, runs the bundled Action on your fixtures, and reads the rows back.

Check the backfill, with a repository that has a build:

```
npm run backfill -- --metric bundlesize --repo ../my-app --every 50 --dry-run --run "npm ci && npm run build"
```

## 8. Add a dashboard

1. The data source needs no change. It sends the token, and each panel sets the route of its metric: `${WORKER_URL}/v1/bundlesize/query`.
2. Build a panel. This query shows the size of one file over time. The `$path` variable is a query variable that lists the files of the newest commit.

   ```json
   {"sql": "SELECT date, bytes, gzip_bytes FROM bundlesize_files WHERE path = ?1 ORDER BY date", "params": ["$path"]}
   ```

3. Export the dashboard with **Export for sharing externally**. Grafana writes a block `__inputs` for the data source. Add a constant input `WORKER_URL`, and use `${WORKER_URL}` in the URL of each panel. The existing files, such as `metrics/tests/dashboard.json`, show the form.
4. Save the file as `metrics/bundlesize/dashboard.json`.

`test/dashboards.test.ts` finds each `metrics/*/dashboard.json`. It sends every query of the dashboard to a local Worker with the data of `fixtures/snapshot.json`. It fails on a SQL error, on a column that the query does not return, and on a panel that returns no row.

Public dashboards do not replace template variables. Start each query that uses a variable with a fallback, as the existing dashboards do: use a default when the parameter is empty or starts with `$`.

## 9. Deploy

```
npm run migrate:remote
npm run deploy
```

Then add the step of `README.md` to a workflow, and import the dashboard. The order matters: the tables must exist before the new code uses them.

## Rules that the core enforces

- The folder name uses lowercase letters and digits only.
- `metric.ts`, `store.ts` and `collect.ts` must exist. `npm run sync` fails if one is missing.
- Each table name starts with the name of the metric.
- A query on the route of a metric cannot name the tables of another metric, `usage`, or a name that starts with `sqlite_`, `d1_`, `_cf_` or `pragma_`. Do not use the word `usage` as a table or column name.
- One ingest writes the rows of one snapshot, plus the rows that it deletes. It must fit in the daily budget (see `docs/setup-cloudflare.md`). Write the cost of one ingest in the `README.md` of the metric.
