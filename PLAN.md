# Devanalytics v1: build plan for agents

This file goes to `../devanalytics/PLAN.md` (a sibling folder of monfil). Every agent reads it before it starts a task.

## Context

Monfil has an internal analytics pipeline for codebase health and CI health:
- The collectors are in `../monfil/scripts/`.
- A Cloudflare Worker with D1 is in `../monfil/infra/devanalytics-worker/`.
- The dashboards are in Grafana Cloud.

It works in production, but it is coupled to monfil: folder names, suite names, workflow names, the Worker URL and the dashboard SQL are hard-coded.

The goal is a standalone product that any TS/JS repository on GitHub Actions can install for free: Cloudflare Workers and D1 for storage, Grafana Cloud for the view. Existing projects can backfill their history once, inside the free limits. The owner will present it in a blog article as a light, free alternative to paid analytics tools.

The new repository starts with no history. Agents copy the code they need from `../monfil/`, then adapt it to be generic. Monfil is read-only for every task before phase 5.

## Decisions (do not change without the owner)

1. **Users:** TS/JS repositories on GitHub Actions. Coverage also accepts lcov. Tests also accept JUnit XML.
2. **One deployment for each repository.** There is no `project` column.
3. **A "metric" is one self-contained folder** in `metrics/<name>/`. To add a metric, add a folder and run `npm run sync`. To remove one, delete the folder and run `npm run sync`. There is no plugin system.
4. **One GitHub Action**, bundled into `action/dist/` and committed, with a `metric` input. Nothing is published to npm.
5. **Grafana Cloud only.** Each metric folder holds its own dashboard JSON.
6. **Backfill is a manual, one-time command.** The user runs it from their fork of the template. It stays inside the daily D1 write limit and resumes on the next day.
7. **Out of v1:** PR comments, the retention cron, an npm CLI, lizard, other CI providers, a built-in HTML view, and local Docker Grafana.

## End-user workflow

### 1. Setup (once, about 15 minutes)

```
Template repo                Cloudflare                     User's app repo                 Grafana Cloud
─────────────                ──────────                     ───────────────                 ─────────────
fork "devanalytics"
  │  click "Deploy to
  │  Cloudflare" ──────────▶ Worker + D1 created
  │  npm run migrate:remote ▶ tables created
  │  wrangler secret put ──▶ INGEST_TOKEN, QUERY_TOKEN
  │                                                        add secret DEVANALYTICS_INGEST_TOKEN
  │                                                        add variable DEVANALYTICS_URL
  │                                                        copy 2 workflow files from
  │                                                          examples/workflows/
  │                                                        add the badge to README.md
  │                                                                                        install Infinity plugin
  │                                                                                        add data source (QUERY_TOKEN)
  │                                                                                        import metrics/*/dashboard.json
  └─ optional: npm run backfill ─▶ history for old commits and runs (one time, over several days if needed)
```

### 2. Every day (automatic)

```
                     User's app repo (GitHub Actions)                     Worker                      D1
                     ────────────────────────────────                     ──────                      ──
push to main ──▶ commit.yml
                  ├─ checkout, install
                  ├─ user's test command (writes coverage + test reports)
                  ├─ uses: devanalytics@v1  metric: complexity ─ snapshot ─▶ POST /v1/complexity/ingest
                  └─ uses: devanalytics@v1  metric: coverage   ─ snapshot ─▶ POST /v1/coverage/ingest
                                                                            │ check INGEST_TOKEN
                                                                            │ parse (Metric.parse)
any workflow ──▶ the user's own test workflow                               │ estimate cost, check budget ─▶ usage
run (PR, push)    └─ upload test reports as artifacts                       │ delete rows of the key
                                                                            │ insert rows (Store.toRows) ──▶ <metric>_* tables
it completes ──▶ runs.yml (on workflow_run)                                 └ 200 { rowsWritten }
                  ├─ download the run's report artifacts
                  ├─ uses: devanalytics@v1  metric: ci    ─ snapshot ─▶ POST /v1/ci/ingest
                  └─ uses: devanalytics@v1  metric: tests ─ snapshot ─▶ POST /v1/tests/ingest
```

- **Commit metrics** (`complexity`, `coverage`) run on push to the default branch only, so there is one snapshot for each merged commit. A second push of the same sha replaces its rows.
- **Run metrics** (`ci`, `tests`) run after each run of the workflows that the user lists in `runs.yml`, on any branch. A re-run attempt is a new key.
- **Collection** happens in the Action, inside the user's CI. The Worker never reads the user's code. It only receives JSON snapshots.
- **Failure:** an upload that fails fails only its own workflow, never the user's tests or releases.

### 3. Reading (any time)

```
Grafana panel ─ POST /v1/<metric>/query { sql, params } + QUERY_TOKEN ─▶ Worker ─ SELECT on <metric>_* only ─▶ D1
              ◀──────────── { rows, truncated, meta } ─────────────────    (Grafana caches each answer 1 hour)

shields.io ──── GET /v1/coverage/badge?folder=.&suite=total (no token) ─▶ Worker ─ one fixed query ─▶ D1
README badge ◀─ { label, message, color } ───────────────────────────────  (cached 1 hour)

owner ───────── GET /v1/usage + QUERY_TOKEN ─▶ rows written today and the limits
```

### 4. Backfill (once, manual)

```
owner's machine: npm run backfill -- --metric coverage --repo ../my-app --tags --run "npm ci && npm test -- --coverage"
  1. list targets (tags, every n commits, or GitHub runs of the last 90 days)
  2. for each target: worktree ─ run command ─ collect ─▶ .backfill/coverage/<sha>.json   (skipped if cached)
  3. upload in date order with X-Devanalytics-Mode: backfill ─▶ Worker
       200 ─ record in state.json, next target
       429 ─ stop: "312 of 540 sent, run again after 00:00 UTC (about 2 days left)"
  4. run the same command again the next day: it resumes from state.json
```

`docs/architecture.md` (task W1) draws these four diagrams in Mermaid.

## The metric contract

The whole interface between the core and a metric fits on one page. `docs/architecture.md` (task W1) draws it as a Mermaid class diagram.

```
metrics/<name>/                     one folder = one metric
├── metric.ts        Metric<S>      shared by Worker and Action (pure, no I/O)
├── store.ts         Store<S>       runs in the Worker
├── collect.ts       Collector<S>   runs in the Action and in backfill
├── migrations/      0001_init.sql, 0002_….sql
├── dashboard.json   Grafana export
├── fixtures/        sample inputs and one snapshot.json
├── *.test.ts
└── README.md        snapshot fields, tables, inputs, rows per ingest

Metric<S>
  name: string                       URL segment and table prefix
  key: 'commit' | 'run'              what one snapshot replaces
  parse(body: unknown): S            validates a snapshot; throws ValidationError

Store<S>
  tables: string[]                   the query allow list (all start with `<name>_`)
  toRows(s: S): TableRows[]          { table, insert, rows }
  badge?(db, params): ShieldsEndpoint

Collector<S>
  inputs: InputSpec[]                name, description, default
  collect(ctx: CollectContext): Promise<S>
  backfill?: 'commits' | 'runs'      how the backfill command lists old data

The core gives:
  Worker:  router, auth, query guard, replace by key, write budget, /usage
  Action:  input parsing, upload with retry, metric dispatch
  Backfill: list targets, collect into a local cache, upload until the budget stops it
  Sync:    generates the two registries and the wrangler migrations folder
```

Conventions that the core enforces:
- **Key columns:** every table of a `commit` metric has `sha` and `date`. Every table of a `run` metric has `run_id`, `run_attempt` and `date`. The core replaces rows by these columns, so `toRows` never deletes.
- **Dates:** `date` is the commit date or the run start time, never the upload time. A backfill then gives correct trends.
- **Table names** start with `<name>_`. The query route of a metric accepts only its own tables.

**`npm run sync`** reads `metrics/*/`. It writes:
- `src/generated/worker-registry.ts`, which imports `metric.ts` and `store.ts` of each metric.
- `action/src/generated/collector-registry.ts`, which imports `metric.ts` and `collect.ts`.
- `migrations/`, which holds the core migrations and copies of `metrics/<name>/migrations/<file>` named `<name>__<file>`. Wrangler applies files in name order and records each name. The metrics do not depend on each other, so the order between metrics does not matter.

The generated files are committed. CI fails if `npm run sync` changes them.

## The four metrics in v1

| Metric | Key | Tables | Source in monfil |
|---|---|---|---|
| `complexity` | commit | `complexity_functions`, `complexity_folder_summary` | Worker `src/complexity/`; `scripts/complexity/metrics.mts`, `naming.mts`, `limits.mts` |
| `coverage` | commit | `coverage_files`, `coverage_folder_summary`, `coverage_tests` | Worker `src/coverage/`; `scripts/coverage/maps.mts`, `merge.mts`, `tests.mts` |
| `tests` | run | `tests_suites`, `tests_exceptions` | the `ci_test_*` parts of Worker `src/ci/`; `scripts/ci/test-report.mts`, `vitest-reporter.mts`, `reports.mts` |
| `ci` | run | `ci_runs`, `ci_jobs`, `ci_steps`, `ci_step_groups` | Worker `src/ci/`; `scripts/ci/collect.mts`, `github.mts`, `snapshot.mts`, `logs.mts`, `log-groups.mts` |

Coverage reporting keeps all its data. Each commit stores:
- Lines, statements, functions and branches for each file and suite.
- The same sums for each folder.
- The test counts for each suite (`coverage_tests`).

`tests` is new. It stores the result of each CI run: the suites for each runner, and the failed and flaky tests. Monfil keeps that data in `ci_test_*` now.

**Suites are generic.** The user names each coverage report (`unit=coverage/unit/lcov.info`).
- When there are two or more reports, the collector also writes a `total` suite. `total` is the union of all reports: Istanbul maps merged with `mergeMaps`, and lcov merged line by line.
- With one report, the collector stores it as `total` only, so no rows are duplicated.
- Monfil's `merged` suite becomes `total`.

**Folders:** rollups include the repository root `.`, so every project has a total without any config.

**Badge:** `GET /v1/coverage/badge?suite=total&folder=.` shows the line coverage of one folder and one suite in the newest snapshot. The defaults are `total` and `.`. In monfil, `folder=src` keeps the current badge. Both parameters are validated and bound, and the query is fixed. There is no badge config in `wrangler.jsonc`.

## Monfil files that stay behind

Do not copy these files:
- `scripts/coverage/vite-plugins.mts`, `overlay.mts` and `dump.mts`.
- Every `compare.mts` and `report.mts`.
- `scripts/devanalytics/markdown.mts`.
- Grafana panel SQL with `'src'`, `'test / '`, `'Run npm ci'` or `theopnv` in it.

## Write budget (core)

The D1 free plan allows 100,000 rows written per day for the whole account. A delete counts as a write.

- A core table `usage(day TEXT PRIMARY KEY, rows_written INTEGER)` counts the rows written by each ingest. It costs one write for each ingest.
- Before an ingest writes, the core estimates the cost: the rows from `toRows`, plus the rows that the replace deletes (one `count(*)` for each table, by key).
- `DAILY_WRITE_LIMIT` in `vars` defaults to 100000. A normal ingest is refused above 95% of it. An ingest with the header `X-Devanalytics-Mode: backfill` is refused above 70%, so CI uploads always have room. The response is `429` with `Retry-After` set to the seconds until 00:00 UTC.
- `GET /v1/usage` (query token) returns `{ day, rowsWritten, limit, backfillLimit }`.
- The docs say that the budget sees only this Worker. Other D1 databases on the same account also use the account limit.

## Backfill (core)

The command is `npm run backfill -- --metric <name> [options]`. The user runs it on their machine from their fork of the template.

1. **List targets.**
   - `commits` metrics take the target repository from `--repo <path>` and the targets from one of `--tags`, `--every <n>` on the default branch, or `--refs <a,b,…>`. `--since <date>` limits each option.
   - `runs` metrics take `--repo <owner/name>` and `--since <date>`, and list runs through the GitHub API with `GITHUB_TOKEN`. The docs say that GitHub keeps logs and artifacts for 90 days by default, so older runs cannot be collected.
2. **Collect into a local cache.**
   - Each target writes `.backfill/<metric>/<key>.json`, in a temporary git worktree for commits (port `inWorktree` from `../monfil/scripts/devanalytics/backfill.mts`).
   - `--run "<command>"` runs a command in the worktree before collection, for example the test command that produces coverage reports.
   - A target that is already in the cache is skipped, so a stopped run resumes.
3. **Upload in date order**, with the backfill header.
   - The client stops at the first `429` and prints the rows sent, the targets left, and the time when the next run can start.
   - `.backfill/<metric>/state.json` records the uploaded keys. A second run on the same day uploads nothing.
   - Ingest replaces by key, so a target that is sent twice is safe.
4. **Refuse early.** If one snapshot costs more than the backfill limit alone, the command stops before the first upload, gives the cost, and says to use `--every` or fewer folders.

`--dry-run` lists the targets and the estimated rows with no upload. The command prints the number of days that the backfill will need.

## Target layout

```
devanalytics/
  PLAN.md  AGENTS.md  README.md  LICENSE
  package.json  tsconfig.json  eslint.config.ts  vitest.config.ts
  wrangler.jsonc               template, no database_id
  core/worker/                 router, auth, query guard, replace, budget, usage, expect, folders
  core/action/                 inputs, upload, dispatch
  core/backfill/               targets, cache, uploader
  core/contract.ts             Metric, Store, Collector, TableRows, InputSpec, CollectContext
  core/migrations/             0001_usage.sql
  metrics/<name>/              see "The metric contract"
  src/index.ts                 Worker entry
  src/generated/               worker registry (from sync)
  action/action.yml  action/src/index.ts  action/src/generated/  action/dist/index.js
  migrations/                  generated by sync
  scripts/sync.mts  scripts/backfill.mts  scripts/smoke.mts
  examples/workflows/
  docs/
```

## Rules for every agent

- Read `PLAN.md` and `AGENTS.md` first. Work only on your task, on branch `task/<id>`, and open a PR to `main`.
- Copy from `../monfil/` and adapt the code. Do not rewrite code that works. Keep the tests that come with it and adapt them.
- Do not edit anything in `../monfil/`.
- A metric task changes only `metrics/<name>/` and the generated files. If you need a change in `core/`, stop and describe it in the PR.
- Use Conventional Commits with a lowercase subject, and relative paths only.
- Write a comment only for a constraint that the code cannot show. Write docs in ASD-STE100 Simplified Technical English.
- Before the PR, run `npm run sync`, `npm run typecheck`, `npm run lint` and `npm test`. A task that changes the Action also runs `npm run build:action` and commits `action/dist/`. In the PR, list the checks that you could not run.

## Tasks

The **Needs** field gives the tasks that must be merged first. Tasks in the same phase can run in parallel.

### Phase 1: core

**T1. Scaffold.** Needs: none.
- Copy the devDependencies, `tsconfig.json`, `vitest.config.ts`, `test/apply-migrations.ts`, `test/env.d.ts` and `.dev.vars.example` from `../monfil/infra/devanalytics-worker/`.
- Add ESLint (typescript-eslint, sonarjs with cognitive 15 and cyclomatic 10) and commitlint.
- Add the scripts: `sync`, `typecheck`, `lint`, `test`, `build:action`, `smoke`, `backfill`, `dev`, `deploy`, and `migrate:local` and `migrate:remote` (both run `sync` first).
- Add the `wrangler.jsonc` template, plus `AGENTS.md` with the rules above.
- Add `.github/workflows/ci.yml`: typecheck, lint, test, and a check that `sync` and `build:action` leave no diff.

Done when CI is green.

**T2. Contract and sync.** Needs: T1.
- Write `core/contract.ts` with the types of "The metric contract".
- Write `scripts/sync.mts`.
- Add a test metric `metrics/example/` (key `commit`, one table, a collector that reads a JSON file).

Done when adding and removing `metrics/example/` with `sync` changes the registries and `migrations/` as expected, and a test checks both cases.

**T3. Worker core.** Needs: T2.
- Copy `../monfil/infra/devanalytics-worker/src/shared/*` to `core/worker/`. Copy the router from `src/index.ts` and build the routes from the registry: `/v1/:metric/ingest`, `/v1/:metric/query`, `/v1/:metric/badge` and `/v1/usage`.
- Generalize `replaceRows` and `replaceRunRows` (`src/shared/replace.ts`) into one replace by key.
- Replace the deny list in `checkTables` (`src/shared/query.ts`) with an allow list of the metric's tables. Refuse `sqlite_*`, `d1_*`, `_cf_*` and `usage`.
- Add the write budget.
- `expectSha` accepts 40 or 64 hex characters. `folderPrefixes` adds `.`.
- Adapt `test/worker.test.ts` and `test/query.test.ts` to `metrics/example/`.

Done when tests cover these cases: auth, 404, 405 and 400; refused system tables and the tables of another metric; a 429 at the normal and the backfill limits with a correct `Retry-After`; and correct `/v1/usage` counts.

**T4. Action core and smoke.** Needs: T2. Can run in parallel with T3.
- Write `action/action.yml` (`runs.using: node24`) and `action/src/index.ts`, with the inputs `metric`, `worker-url`, `token` and `working-directory` plus the inputs of the metric.
- Port `../monfil/scripts/devanalytics/upload.mts` to `core/action/`. Add retry with backoff on 5xx and network errors. A 429 fails with the `Retry-After` time in the message.
- Add the empty-token check from `../monfil/.github/actions/check-ingest-credential/action.yml`, and the esbuild bundle.
- `scripts/smoke.mts` starts `wrangler dev` with a local D1, runs the bundle for each metric named on the command line against its `fixtures/`, and reads the rows back.
- **Early risk:** prove that esbuild can bundle ESLint, `eslint-plugin-sonarjs` and `@typescript-eslint/typescript-estree`. If it cannot, describe the fallback in the PR: the Action runs `npm ci --omit=dev` in its own folder.

Done when `npm run smoke -- example` passes.

**T5. Backfill.** Needs: T3, T4.
- Write `core/backfill/` and `scripts/backfill.mts` as described in "Backfill (core)". Reuse `inWorktree` and `headCommit` from `../monfil/scripts/devanalytics/`.

Done when tests with a local Worker and `DAILY_WRITE_LIMIT=50` show four cases: the command stops at the budget, writes `state.json`, resumes, and refuses a snapshot that is too large.

### Phase 2: metrics (four agents in parallel; needs T3 and T4)

Each metric task:
1. Fills its folder as described in "The metric contract". Merge the old monfil migrations of the metric into one `0001_init.sql`.
2. Adds the fixtures and the tests copied from monfil.
3. Sets `backfill` on the collector.
4. Writes `README.md` with the snapshot fields, tables, inputs, the rows for each ingest, and the workflow step to copy. Metric tasks do not edit `examples/workflows/`. Task W2 writes those files.

Done when the metric tests pass, `npm run smoke -- <name>` passes, and `npm run backfill -- --metric <name> --dry-run` lists targets on a fixture repository (needs T5).

**K1. complexity.**
- Inputs: `include` globs (default `src/**/*.{ts,tsx,js,jsx}`), `exclude`, `test-pattern` (default `**/*.test.*`), `cognitive-limit` (15) and `cyclomatic-limit` (10).
- The snapshot carries the limits, so `toRows` computes `above_limits` with the user's values.
- Backfill: commits.

**K2. coverage.**
- Input `reports`: one `suite=path` pair on each line. The file gives the format: Istanbul `coverage-final.json` or `lcov.info`. Add an lcov parser.
- Optional input `test-results`: `suite=path` lines (Vitest JSON, Playwright JSON or JUnit) for `coverage_tests`.
- Add the `total` suite rule and the badge with parameters. Remove the `src/` root rule from `sourcePath`.
- Backfill: commits, with `--run`.

**K3. tests.**
- Input `reports`: `suite=path` lines over an artifact folder with one subfolder for each runner. The formats are JUnit XML, Vitest JSON and Playwright JSON. Add a JUnit parser.
- Ship the Vitest reporter as `action/reporters/vitest.mjs` for flaky data.
- Backfill: runs (artifacts).

**K4. ci.**
- Inputs: `run-id`, `run-attempt` and `github-token`. The defaults come from the `workflow_run` event.
- Remove the `Test`/`Publish` enum and the `full_matrix` and `code_changed` columns. Add an optional `labels` JSON text column that the user fills with `key=value` lines.
- Backfill: runs.

### Phase 3: dashboards and docs (parallel)

**D1 to D4. One dashboard for each metric.** Needs: the matching K task.
- Write `metrics/<name>/dashboard.json` in the Grafana export format, with `${DS_DEVANALYTICS}`, `${WORKER_URL}` and the metric variables (`folder`, `suite`, `repo_url`, `group`).
- Port the panel SQL from the "Grafana dashboards" part of `../monfil/infra/devanalytics-worker/README.md`. Remove every monfil literal, and keep the `f(folder)` fallback for public dashboards.

Done when a test posts every panel query to the local Worker with no SQL error. The owner checks the import in Grafana Cloud by hand.

**W1. Architecture page.** Needs: T2, T3.
- `docs/architecture.md`: one Mermaid class diagram of the contract that fits an A4 page, the four diagrams of "End-user workflow" in Mermaid, and how to add, change and remove a metric.

**W2. Quick start and Cloudflare guide.** Needs: phase 2.
- `README.md` with a "Deploy to Cloudflare" button and the setup steps of "End-user workflow".
- `examples/workflows/commit.yml` (push to the default branch: complexity and coverage) and `examples/workflows/runs.yml` (`workflow_run`: download artifacts, then ci and tests). Build them from the workflow steps in each metric `README.md`.
- `docs/setup-cloudflare.md`: D1, migrations, secrets, free limits, the write budget, and the cost of each metric.

**W3. Grafana guide.** Needs: D1 to D4.
- `docs/setup-grafana.md`: Infinity, the data source with the query token, a cache TTL of 1 hour, a fixed time range, import, and `$var` on public dashboards.

**W4. Backfill and metric guides.** Needs: T5 and phase 2.
- `docs/backfill.md`: options, segmentation over days, and the GitHub 90-day limit.
- `docs/write-a-metric.md`: a walk-through with an example `bundle-size` metric in `examples/metrics/bundle-size/`. It is not active by default.

**W5. Security guide.** Needs: T3.
- `docs/security.md`: the tokens, the query guard, the public badge, public dashboards, and token rotation.

### Phase 4: release (owner with one agent)

**R1.** Tag `v1.0.0` and move `v1`. Test the deploy button on a fresh Cloudflare account. Run the example workflows and one backfill in a throwaway public repository.

### Phase 5: monfil adoption (in the monfil repository, after R1)

**P1.** Deploy a new Worker from the template for monfil.
- Write a one-off SQL script that copies the old D1 (`monfil-complexity`) into the new tables. `coverage_tests` maps one to one. `merged` becomes `total`. `ci_test_*` goes to `tests_*`.
- If a copy is not possible, use `npm run backfill` for complexity and coverage on the release tags.
- The owner runs the remote steps.

**P2.** Change the monfil workflows to `uses: <owner>/devanalytics@v1`. Remove `infra/devanalytics-worker/`, the moved scripts and the old workflows. Update the contributor guide pages. Use the `ci:` commit type.

### Phase 6: article

**A1.** Measure one month of monfil usage with `/v1/usage` and the Cloudflare dashboard.

**A2.** The owner drafts the post. An agent runs it through `/no-slop`.

## Dependency summary

```
T1 ── T2 ─┬─ T3 ─┬─ T5 ───────────────┐
          │      ├─ W1, W5            │
          └─ T4 ─┴─ K1..K4 ─┬─ D1..D4 ─ W3 ─┐
                            └─ W2, W4 ──────┴─ R1 ── P1 ── P2 ── A1 ── A2
```

## Verification for the whole project

- `npm run sync` leaves no diff. `npm run typecheck`, `npm run lint` and `npm test` pass in CI.
- `npm run smoke -- complexity coverage tests ci` collects the fixtures, uploads through the bundled Action to `wrangler dev`, and reads the rows back.
- With a low `DAILY_WRITE_LIMIT`, a backfill stops, resumes on the next run, and finishes with the same rows as one large run.
- Every dashboard query runs on the local Worker with no error.
- R1: the deploy button, the example workflows and one backfill work in a throwaway repository. The coverage badge renders on shields.io.
