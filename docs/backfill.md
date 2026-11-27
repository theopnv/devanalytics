# Backfill

A backfill loads the history of an existing project into your Worker, one time. After it, your charts show the past and not only the days since you installed Devanalytics.

You run the command on your machine, in your fork of the template. It stays inside the daily write limit of D1. When the limit stops it, you run the same command again on the next day, and it continues.

## Before you start

- Deploy the Worker and create the tables (see `docs/setup-cloudflare.md`).
- Run `npm ci` in your fork.
- Set two variables in your shell:

  ```
  export DEVANALYTICS_URL="https://devanalytics.<your-subdomain>.workers.dev"
  export DEVANALYTICS_INGEST_TOKEN="<INGEST_TOKEN>"
  ```

- For a metric of runs, also set `GITHUB_TOKEN` to a token that can read the Actions of the repository. With the GitHub CLI: `export GITHUB_TOKEN="$(gh auth token)"`.
- If you changed `DAILY_WRITE_LIMIT` in `wrangler.jsonc`, set the same value in your shell. The command uses it to estimate the days.

## The command

```
npm run backfill -- --metric <name> [options]
```

| Option | Meaning |
|---|---|
| `--metric <name>` | The metric to load: `complexity`, `coverage`, `tests` or `ci`. |
| `--repo <path or owner/name>` | The repository. Use a path on your disk for a metric of commits. Use `owner/name` for a metric of runs. |
| `--tags` | Commits: one target for each tag. |
| `--every <n>` | Commits: one target for every n-th commit of the default branch. |
| `--refs <a,b,...>` | Commits: the named branches, tags or commits. |
| `--branch <name>` | Commits: the branch that `--every` walks. The default branch is the default. |
| `--since <date>` | Use only targets from this date, for example `2026-01-31`. |
| `--run <command>` | Commits: a shell command to run in the checkout before the collection. |
| `--input <name=value>` | An input of the metric, the same as in the workflow. You can repeat it. |
| `--dir <folder>` | The cache folder. The default is `.backfill`. |
| `--worker-url <url>` | The Worker. The default is the `DEVANALYTICS_URL` variable. |
| `--dry-run` | List the targets, the rows and the days. Upload nothing. |

For a metric of commits, give one of `--tags`, `--every` and `--refs`.

## Metrics of commits: `complexity` and `coverage`

The command makes a temporary git worktree for each commit, collects the metric there, and removes the worktree.

Complexity from every tag:

```
npm run backfill -- --metric complexity --repo ../my-app --tags
```

Coverage from every 20th commit. An old commit has no coverage report, so `--run` makes one in the worktree first:

```
npm run backfill -- --metric coverage --repo ../my-app --every 20 \
  --run "npm ci && npx vitest run --coverage --coverage.reporter=lcov" \
  --input "reports=unit=coverage/lcov.info"
```

The `--input` option names the files that the command writes. An input that you repeat keeps its last value. For two reports, give one value with a line break between them. In a POSIX shell:

```
--input $'reports=unit=coverage/unit/lcov.info\ne2e=coverage/e2e/lcov.info'
```

## Metrics of runs: `ci` and `tests`

The command lists the workflow runs of the last 90 days with the GitHub API, and collects each run.

```
npm run backfill -- --metric ci --repo <owner>/<repository> --since 2026-09-01
npm run backfill -- --metric tests --repo <owner>/<repository> --since 2026-09-01 \
  --input $'reports=unit=unit.json\ne2e=e2e.json'
```

### The limit of 90 days

GitHub keeps the logs and the artifacts of a run for 90 days by default. A run that is older cannot be collected, so the list starts 90 days ago, also when `--since` is earlier. A repository can set a shorter time.

GitHub lists only the newest attempt of each run, so a backfill records one attempt for each run.

## See the cost first

Run the command with `--dry-run`:

```
npm run backfill -- --metric coverage --repo ../my-app --every 20 --dry-run --run "..." --input "reports=..."
```

The command collects the targets into the cache, and then prints one line for each target:

```
2026-03-02  3f2a9c1  1740 rows
...
27 targets to upload, 46980 rows. At 70000 rows for each day, this needs about 1 day.
```

The collection is done, so the next command without `--dry-run` finds the snapshots in the cache and uploads them.

## How it stays inside the limit

The write budget of the Worker is explained in `docs/setup-cloudflare.md`. A backfill ingest has the header `X-Devanalytics-Mode: backfill`, and the Worker refuses it above 70% of the daily limit. Your normal uploads from CI keep the other 30%.

1. **List the targets.** The command lists the commits or the runs, oldest first.
2. **Collect into the cache.** Each target writes `.backfill/<metric>/<key>.json`. A target that is in the cache is skipped, so a command that you stopped resumes.
3. **Upload in date order.** After each upload, the command writes the key into `.backfill/<metric>/state.json`. At the first answer `429`, it stops and prints how many targets are uploaded, how many days remain, and when the next run can start:

   ```
   Stopped by the write budget: 12 of 27 targets are uploaded. Run the same command again after 00:00 UTC (in 31200 seconds). About 1 more day are needed at 70000 rows for each day.
   ```

4. **Run the same command again** after 00:00 UTC. It finds the uploaded keys in `state.json`, and it sends the rest. A second run on the same day uploads nothing.

A snapshot replaces the rows of its commit or run, so a target that is sent two times does no harm.

`state.json` records the Worker that it belongs to. If you change `DEVANALYTICS_URL`, the command stops and asks you to delete the file.

### A snapshot that is too large

The command checks the cost of each snapshot before it uploads anything. If one snapshot needs more rows than the backfill limit of a whole day, no day can take it. The command stops, prints the cost, and uploads nothing. Then:

- Use `--every <n>` with a larger `n`, to take fewer commits. This does not make one snapshot smaller.
- For `coverage`, use one report, because each suite writes its own rows.
- Collect fewer files: set `include` and `exclude` for `complexity`, or use a smaller `working-directory`.

## Common problems

| Message | Fix |
|---|---|
| `Set --repo to the path of the repository.` | Add `--repo`. |
| `Choose the commits with one of --tags, --every <n> and --refs` | A metric of commits needs a selection. |
| `Set the GITHUB_TOKEN variable to list the runs.` | Export `GITHUB_TOKEN`. |
| `Set the DEVANALYTICS_URL and DEVANALYTICS_INGEST_TOKEN variables, or use --dry-run.` | Export both variables. |
| `Skipped <target>: ...` | The collection failed for this target. The command tries it again on the next run. |
