# Devanalytics

A light and free way to watch the health of a TypeScript or JavaScript repository on GitHub Actions. It tracks the complexity of the code, the test coverage, the flaky tests and the speed of your CI.

- **Collect.** A GitHub Action reads your repository in your own CI and sends small JSON snapshots.
- **Store.** A Cloudflare Worker keeps the snapshots in a D1 database. Your code never leaves your CI.
- **View.** Grafana Cloud draws the dashboards. A public badge shows your coverage.

Everything fits in the free plans of Cloudflare, GitHub and Grafana Cloud. You deploy one Worker for each repository.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/theopnv/devanalytics)

## The metrics

| Metric | What it records | When | Dashboard |
|---|---|---|---|
| [`complexity`](metrics/complexity/README.md) | Cognitive and cyclomatic complexity of each function | Each push to the default branch | `metrics/complexity/dashboard.json` |
| [`coverage`](metrics/coverage/README.md) | Line, statement, function and branch coverage of each file, suite and folder. It reads Istanbul JSON and lcov. | Each push to the default branch | `metrics/coverage/dashboard.json` |
| [`tests`](metrics/tests/README.md) | Test counts, failed tests and flaky tests of each CI run. It reads JUnit XML, Vitest JSON and Playwright JSON. | Each run of your workflows | `metrics/tests/dashboard.json` |
| [`ci`](metrics/ci/README.md) | Time of each run, job, step and log group | Each run of your workflows | `metrics/ci/dashboard.json` |

You can use one metric or all four. A metric is one folder in `metrics/`. To add or remove one, see [`docs/architecture.md`](docs/architecture.md).

## Quick start

The setup takes about 15 minutes.

1. **Fork this repository** and clone your fork.
2. **Deploy the Worker.** Select the "Deploy to Cloudflare" button, or run `npm ci` and `npm run deploy`.
3. **Create the tables.** Run `npm run migrate:remote`.
4. **Set the secrets.** Make two random values with `openssl rand -hex 32`. Run `npx wrangler secret put INGEST_TOKEN` and `npx wrangler secret put QUERY_TOKEN`.
5. **Connect your repository.** In your application repository, add the secret `DEVANALYTICS_INGEST_TOKEN` and the variable `DEVANALYTICS_URL` (the address of the Worker). Copy [`examples/workflows/commit.yml`](examples/workflows/commit.yml) and [`examples/workflows/runs.yml`](examples/workflows/runs.yml) into `.github/workflows/`.
6. **Add the badge** to the `README.md` of your repository:

   ```
   ![coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fdevanalytics.<your-subdomain>.workers.dev%2Fv1%2Fcoverage%2Fbadge)
   ```

   The badge shows the line coverage of the suite `total` and the folder `.`. Add `%3Fsuite%3Dunit%26folder%3Dsrc` after `badge` to choose another suite or folder.
7. **Draw the dashboards.** Install the Infinity plugin in Grafana Cloud, add a data source with the `QUERY_TOKEN`, and import `metrics/*/dashboard.json`.
8. **Optional: load your history.** Run `npm run backfill`. It stays inside the free limits and continues on the next day when it must.

Each step has a guide:

- [Set up Cloudflare](docs/setup-cloudflare.md): the Worker, the database, the secrets, the free limits and the cost of each metric.
- [Set up Grafana](docs/setup-grafana.md): the plugin, the data source, the import and public dashboards.
- [Backfill](docs/backfill.md): load old commits and runs.
- [Security](docs/security.md): the tokens, the query guard and how to rotate a token.
- [Architecture](docs/architecture.md): the contract between the core and a metric, and the four flows.
- [Write a metric](docs/write-a-metric.md): add your own metric.
- [Release](docs/release.md): publish a version and test it.

## Commands

| Command | Use |
|---|---|
| `npm run sync` | Generate the registries and `migrations/` from `metrics/*/`. |
| `npm run migrate:local`, `npm run migrate:remote` | Apply the migrations to the local or the remote database. |
| `npm run dev` | Start the Worker on a local database. |
| `npm run deploy` | Deploy the Worker. |
| `npm run backfill -- --metric <name>` | Load old history. |
| `npm run smoke -- <metric>` | Test a metric from the Action to a local Worker. |
| `npm run typecheck`, `npm run lint`, `npm test` | The checks that CI runs. |

## Limits

- One deployment for each repository.
- TypeScript and JavaScript repositories on GitHub Actions.
- The dashboards are for Grafana Cloud.
- A backfill of runs reaches back 90 days, because GitHub keeps logs and artifacts for that time.
