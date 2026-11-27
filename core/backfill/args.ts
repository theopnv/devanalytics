import { parseArgs } from 'node:util';
import type { Selection } from './targets.ts';

export const USAGE = `Usage: npm run backfill -- --metric <name> [options]

  --repo <path|owner/name>   The repository to read. A path for a metric of commits, owner/name for a metric of runs.
  --tags                     Commits: one target for each tag.
  --every <n>                Commits: one target for every n-th commit of the default branch.
  --refs <a,b,...>           Commits: the named refs.
  --branch <name>            Commits: the branch that --every walks. The default branch is the default.
  --since <date>             Only targets from this date. For runs, the default is 90 days ago.
  --run <command>            Commits: a shell command to run in the checkout before the collection.
  --input <name=value>       An input of the metric. Can be repeated.
  --dir <folder>             The cache folder. The default is .backfill.
  --worker-url <url>         The Worker. The default is the DEVANALYTICS_URL variable.
  --dry-run                  Collect and list the targets, the rows and the days. Upload nothing.

The ingest token is read from DEVANALYTICS_INGEST_TOKEN, and the GitHub token for runs from GITHUB_TOKEN.
Set DAILY_WRITE_LIMIT to the value of the Worker if it is not the default of 100000.`;

export class UsageError extends Error {
  override name = 'UsageError';
}

export interface BackfillOptions {
  metric: string;
  repo: string | undefined;
  selection: Selection | undefined;
  since: Date | undefined;
  branch: string | undefined;
  command: string | undefined;
  inputs: Record<string, string>;
  dryRun: boolean;
  dir: string;
  workerUrl: string | undefined;
}

function parseEvery(every: string): Selection {
  const step = Number(every);
  if (!Number.isSafeInteger(step) || step < 1) {
    throw new UsageError('--every must be a whole number that is 1 or more.');
  }
  return { kind: 'every', step };
}

function parseRefs(refs: string): Selection {
  const names = refs.split(',').map((ref) => ref.trim()).filter(Boolean);
  if (names.length === 0) {
    throw new UsageError('--refs needs at least one ref.');
  }
  return { kind: 'refs', refs: names };
}

function parseSelection(tags: boolean | undefined, every: string | undefined, refs: string | undefined): Selection | undefined {
  const chosen = [tags ? 'tags' : '', every === undefined ? '' : 'every', refs === undefined ? '' : 'refs'].filter(Boolean);
  if (chosen.length > 1) {
    throw new UsageError(`Use one of --tags, --every and --refs. You gave ${chosen.map((name) => `--${name}`).join(' and ')}.`);
  }
  if (every !== undefined) {
    return parseEvery(every);
  }
  if (refs !== undefined) {
    return parseRefs(refs);
  }
  return tags ? { kind: 'tags' } : undefined;
}

function parseInputs(pairs: string[]): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const pair of pairs) {
    const split = pair.indexOf('=');
    if (split < 1) {
      throw new UsageError(`--input "${pair}" must look like name=value.`);
    }
    inputs[pair.slice(0, split)] = pair.slice(split + 1);
  }
  return inputs;
}

function parseSince(value: string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new UsageError(`--since "${value}" is not a date. Use a date such as 2026-01-31.`);
  }
  return date;
}

export function parseBackfillArgs(argv: readonly string[]): BackfillOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        'metric': { type: 'string' },
        'repo': { type: 'string' },
        'tags': { type: 'boolean' },
        'every': { type: 'string' },
        'refs': { type: 'string' },
        'branch': { type: 'string' },
        'since': { type: 'string' },
        'run': { type: 'string' },
        'input': { type: 'string', multiple: true },
        'dir': { type: 'string' },
        'worker-url': { type: 'string' },
        'dry-run': { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (!values.metric) {
    throw new UsageError('Set --metric to the name of a metric.');
  }
  return {
    metric: values.metric,
    repo: values.repo,
    selection: parseSelection(values.tags, values.every, values.refs),
    since: parseSince(values.since),
    branch: values.branch,
    command: values.run,
    inputs: parseInputs(values.input ?? []),
    dryRun: values['dry-run'] ?? false,
    dir: values.dir ?? '.backfill',
    workerUrl: values['worker-url'],
  };
}
