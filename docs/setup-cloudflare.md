# Set up Cloudflare

The Worker receives the snapshots of your repository and keeps them in a D1 database. Everything fits in the free plan of Cloudflare for a normal repository.

You need:

- A Cloudflare account. The free plan is enough.
- Node.js 24 or newer.
- Your fork of this template, cloned on your machine.

## 1. Deploy the Worker

### With the button

1. Open the "Deploy to Cloudflare" button in `README.md`.
2. Connect your GitHub account and choose a name for the Worker and for the database.
3. If the page asks for `INGEST_TOKEN` and `QUERY_TOKEN`, enter two different random values. Make each one with `openssl rand -hex 32`. Do not keep the example values from `.dev.vars.example`.
4. Wait for the deploy to end. Copy the address of the Worker. It looks like `https://devanalytics.<your-subdomain>.workers.dev`.

### With the command line

In your clone, run:

```
npm ci
npx wrangler login
npm run deploy
```

`npm run deploy` creates the Worker. Because `wrangler.jsonc` has no `database_id`, Wrangler also creates the D1 database `devanalytics` and binds it as `DB`. The command prints the address of the Worker.

## 2. Create the tables

```
npm run migrate:remote
```

The command runs `npm run sync`, and then applies the files of `migrations/` to the remote database. It applies a file one time only, so you can run it again after an update.

## 3. Set the secrets

The Worker has two secrets. `docs/security.md` explains what each one allows.

1. Make two different values: `openssl rand -hex 32`. Keep both in a password manager.
2. Set the first value as the ingest token. Wrangler asks you for the value:

   ```
   npx wrangler secret put INGEST_TOKEN
   ```

3. Set the second value as the query token:

   ```
   npx wrangler secret put QUERY_TOKEN
   ```

Skip this step for the secret that the deploy button already set.

## 4. Check the Worker

Replace the address and the token, and run:

```
curl -H "Authorization: Bearer <QUERY_TOKEN>" https://devanalytics.<your-subdomain>.workers.dev/v1/usage
```

The answer looks like this:

```json
{ "day": "2026-11-27", "rowsWritten": 0, "limit": 95000, "backfillLimit": 70000 }
```

A new secret can need a few seconds before the Worker uses it. If you get `401`, wait 10 seconds and try again. If the answer stays `401`, the token is wrong, or `QUERY_TOKEN` is not set. An answer of `422` about a missing table means that you did not run step 2.

## 5. Connect your repository

In your application repository, add the ingest token as a secret and the address as a variable. With the GitHub CLI:

```
gh secret set DEVANALYTICS_INGEST_TOKEN --repo <owner>/<repository>
gh variable set DEVANALYTICS_URL --repo <owner>/<repository> --body "https://devanalytics.<your-subdomain>.workers.dev"
```

`gh secret set` asks you for the value. Then copy the two files of `examples/workflows/` into `.github/workflows/` of your repository.

## Free limits

| Limit | Free plan | Used by |
|---|---|---|
| D1 rows written each day | 100,000 for the whole account | Each ingest |
| D1 rows read each day | 5,000,000 for the whole account | Each Grafana panel query, each badge call |
| D1 storage | 5 GB for the whole account | The rows of all metrics |
| Worker requests each day | 100,000 | Ingests, queries and badge calls |
| Worker CPU time | 10 ms for each request | A large ingest |

A delete counts as a write. A second ingest of the same commit or run deletes the old rows first, so it costs about twice as much.

A very large snapshot can pass the CPU limit of a request. The answer is then the Cloudflare error 1102. Collect fewer files, or use the Workers Paid plan.

## The write budget

The Worker counts the rows that it writes in the table `usage`, one row for each UTC day. Before it writes, it estimates the cost of the ingest: the rows to insert, the rows that the replace deletes, and one row for `usage`.

- The variable `DAILY_WRITE_LIMIT` in `wrangler.jsonc` is 100000, the limit of the free plan. Change it if your plan is different.
- The Worker refuses a normal ingest when the day would pass 95% of the limit.
- The Worker refuses a backfill ingest, which has the header `X-Devanalytics-Mode: backfill`, when the day would pass 70% of the limit. Your CI uploads always have room.
- A refused ingest gets the answer `429` with the header `Retry-After`. The value is the number of seconds until 00:00 UTC.
- `GET /v1/usage` shows the rows written today and the two ceilings.

The budget sees only this Worker. Other D1 databases on the same account also use the limit of the account. If you have them, set `DAILY_WRITE_LIMIT` lower.

## The cost of each metric

All numbers are rows written by one ingest. Each ingest adds one row to `usage`.

| Metric | When it runs | Rows for one ingest | Example |
|---|---|---|---|
| `complexity` | Each push to the default branch | One for each function, plus two for each folder | 1000 functions in 40 folders: about 1,080 |
| `coverage` | Each push to the default branch | One for each file and suite, plus one for each folder and suite, plus one for each test suite | 300 files, 30 folders and 2 suites: about 660 |
| `ci` | Each run of a workflow that you list | One for the run, plus one for each job, step and log group | 4 jobs, 12 steps and 8 groups for each job: about 85 |
| `tests` | Each run of a workflow that you list | One for each suite and runner, plus one for each failed or flaky test | 3 suites on 3 runners and 5 exceptions: about 14 |

An example for a repository with 20 merges and 60 workflow runs each day: `20 × (1,080 + 660)` for the commit metrics gives about 35,000 rows, and `60 × (85 + 14)` for the run metrics gives about 6,000 rows. The total is about 41,000 rows each day, which is below the limit. If a day passes the limit, use fewer coverage suites, or collect fewer folders.

The `rows read` limit grows with the use of your dashboards. A Grafana query cache of 1 hour keeps it low on a plan that has one (see `docs/setup-grafana.md`). A test with a small repository (421 functions and 17 CI runs) read about 3,400 rows for one view of all four dashboards. The panel "Top functions" grows with the size of the newest commit, and the CI panels grow with the number of runs, because they read the whole history.

## Local development

```
cp .dev.vars.example .dev.vars
npm run migrate:local
npm run dev
```

The Worker runs on a local D1 database. The values in `.dev.vars` are for local use only.

## Update the Worker

After you pull a new version of the template, or after you add or remove a metric:

```
npm run migrate:remote
npm run deploy
```

Run the two commands in this order. The tables must exist before the new code uses them.

To read the logs of the Worker while a workflow runs:

```
npx wrangler tail
```
