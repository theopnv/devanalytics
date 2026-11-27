# Security

This page explains what protects your Worker, what each token can do, and how to rotate the tokens.

## What the Worker stores

The Worker stores file paths, function names, test titles, the first line of test errors, commit shas, workflow names, branch names, job names, step names and the names of log groups. It does not store source code or the body of a log. Treat this data as private if your repository is private.

A log group name can hold the first line of a `run:` command, for example `Run npm ci`. GitHub hides the value of a secret in logs, but do not write a secret in a command line.

## Tokens

The Worker has two secrets. They are separate, so a leak of one does not give the other.

| Secret | Allows | Who holds it |
|---|---|---|
| `INGEST_TOKEN` | Write snapshots. Route: `POST /v1/<metric>/ingest`. | The GitHub secret `DEVANALYTICS_INGEST_TOKEN` in your app repository. The backfill command. |
| `QUERY_TOKEN` | Read rows with a `SELECT`. Routes: `POST /v1/<metric>/query` and `GET /v1/usage`. | The Grafana data source. You. |

- Use two different long random values. Make them with `openssl rand -hex 32`.
- A route refuses a request when its token is not set. An unset secret never opens a route.
- The Worker compares tokens in constant time.
- Never put `QUERY_TOKEN` in a workflow. Never put `INGEST_TOKEN` in Grafana.
- For local work, the tokens are in `.dev.vars`. Git ignores this file. `.dev.vars.example` holds values for local tests only.

### What a leaked ingest token allows

A person with `INGEST_TOKEN` can write rows into your database. The write budget limits the damage: the Worker refuses an ingest above 95% of `DAILY_WRITE_LIMIT` rows for each UTC day. That person can still fill the budget of a day and replace the rows of a commit or a run. The token cannot read data. Rotate it.

### What a leaked query token allows

A person with `QUERY_TOKEN` can read every table of every metric through the query routes. The query guard (below) limits what a query can touch. The person cannot write. A costly query uses your D1 read quota, which is 5 million rows each day on the free plan. Rotate the token.

## Pull requests and fork secrets

GitHub does not give secrets to a workflow that a pull request from a fork starts. The example workflows run in two places that a pull request cannot control:

- `commit.yml` runs on a push to the default branch.
- `runs.yml` runs on `workflow_run`. It runs the version of the workflow that is on the default branch.

Do not run the Action in a `pull_request_target` workflow that checks out the code of the pull request. That code could read the token.

The Action fails at once with a clear message when the token is empty, so a missing secret does not cause a late error.

## The query guard

The query route runs SQL that comes from the caller, so the Worker checks each request before it reaches D1.

- The statement must start with `SELECT` or `WITH`.
- The statement must be one statement. A `;` inside it is refused.
- The statement has at most 10,000 characters, and at most 20 parameters. A parameter is a string, a number or `null`.
- The statement may name only the tables of its own metric. A name from another metric is refused, for example `ci_runs` on the `coverage` route.
- The statement may not name `usage`, or a name that starts with `sqlite_`, `d1_`, `_cf_` or `pragma_`.
- The Worker wraps the statement in `SELECT * FROM (...) LIMIT 10001`, so a statement that is not a `SELECT` is a syntax error. A response has at most 10,000 rows, and it says `truncated` when there are more.
- Panels pass values as bound parameters (`?1`), never inside the SQL text.

The check reads the text of the statement. It looks for names, and it ignores case and quotes. This makes some safe statements illegal, for example a column that is called `usage`. It keeps a statement from reading a table that it does not own.

D1 can return an error text from SQLite, such as a failed constraint. Only a caller with a valid token sees it.

## The public badge

`GET /v1/coverage/badge` needs no token, because shields.io must read it.

- It is read-only, and it runs one fixed query.
- It reads `suite` and `folder` from the URL. The Worker checks both, and binds them as parameters. They never become SQL text.
- It returns the label, the line coverage of one folder and one suite, and a color. It returns nothing else.
- The response has `Cache-Control: public, max-age=3600`. shields.io caches it. A direct call always runs one query on D1.

If you do not want a public badge, remove the `badge` function from `metrics/coverage/store.ts`, run `npm run sync` and deploy.

## Public dashboards

A Grafana public dashboard shows its panels to anyone with the link.

- The query token stays in the Grafana data source. A viewer cannot read it, and cannot change a query. The dashboards use the backend parser of Infinity for this reason.
- A viewer sees all the data that the panels show: file paths, function names, test titles and error lines.
- Use a public dashboard for a public repository only.
- Public dashboards do not support template variables. Each panel query uses a fallback when the variable is not replaced. The fallback is the root folder `.`, the suite `total`, the workflow with the most runs, and the log group with the most time.
- On a Grafana plan with query caching, Grafana caches each answer for one hour, so a public dashboard does not send each view to D1. Without a cache, each view reads D1. Check the read limit in `docs/setup-cloudflare.md`.

## Rotate a token

Rotate a token when a person who knew it leaves, when it appears in a log or a screenshot, or every year.

### Ingest token

1. Make a new value: `openssl rand -hex 32`.
2. Set it on the Worker: `npx wrangler secret put INGEST_TOKEN`. The new value is live at once.
3. Set the same value in the GitHub secret `DEVANALYTICS_INGEST_TOKEN` of each repository that sends data.

Between step 2 and step 3, an upload fails with `401`. It fails only its own workflow. Run the workflow again after step 3.

### Query token

1. Make a new value: `openssl rand -hex 32`.
2. Set it on the Worker: `npx wrangler secret put QUERY_TOKEN`.
3. Set the same value as the Bearer token of the Grafana data source, and save it.

Between step 2 and step 3, the panels show an error. They show data again after step 3.
