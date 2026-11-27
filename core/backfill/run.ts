import { InputError } from '../action/inputs.ts';
import type { Env } from '../action/inputs.ts';
import type { UploadOptions, UploadTarget } from '../action/upload.ts';
import type { CollectorEntry, WorkerEntry } from '../contract.ts';
import { estimateCost, limitsFrom } from '../worker/budget.ts';
import type { Limits } from '../worker/budget.ts';
import { UsageError } from './args.ts';
import type { BackfillOptions } from './args.ts';
import { openCache } from './cache.ts';
import type { Cache } from './cache.ts';
import { collectTarget } from './collect.ts';
import { listCommitTargets, listRunTargets, retentionStart } from './targets.ts';
import type { Selection, Target } from './targets.ts';
import { uploadAll } from './uploader.ts';
import type { Pending, Stop } from './uploader.ts';

export interface BackfillDeps {
  workers: readonly WorkerEntry[];
  collectors: readonly CollectorEntry[];
  env: Env;
  log(line: string): void;
  fetch?: typeof fetch;
  now?: () => Date;
  uploadOptions?: UploadOptions;
}

export type BackfillStatus = 'done' | 'stopped' | 'dry-run' | 'too-large' | 'no-targets' | 'failed';

export interface BackfillResult {
  status: BackfillStatus;
  /** The targets that are uploaded, with the ones from earlier runs. */
  uploaded: number;
  total: number;
  skipped: number;
  /** 0 when the command did its work or stopped at the budget, and 1 when it could not. */
  exitCode: 0 | 1;
}

type Kind = 'commits' | 'runs';

interface Setup {
  worker: WorkerEntry;
  entry: CollectorEntry;
  kind: Kind;
  limits: Limits;
  repo: string;
}

const RUN_REPO = /^[A-Za-z0-9-]+\/[\w.-]+$/;

function setup(options: BackfillOptions, deps: BackfillDeps): Setup {
  const worker = deps.workers.find(({ metric }) => metric.name === options.metric);
  const collector = deps.collectors.find(({ metric }) => metric.name === options.metric);
  if (!worker || !collector) {
    throw new UsageError(`Unknown metric "${options.metric}". The metrics in this version are: ${deps.workers.map(({ metric }) => metric.name).join(', ') || 'none'}.`);
  }
  const kind = collector.collector.backfill;
  if (!kind) {
    throw new UsageError(`The metric ${options.metric} does not support backfill.`);
  }
  if (!options.repo) {
    throw new UsageError(kind === 'commits' ? 'Set --repo to the path of the repository.' : 'Set --repo to owner/name.');
  }
  const declared = collector.collector.inputs.map(({ name }) => name);
  const unknown = Object.keys(options.inputs).filter((name) => !declared.includes(name));
  if (unknown.length > 0) {
    throw new UsageError(`The metric ${options.metric} has no input named ${unknown.join(', ')}. Its inputs are: ${declared.join(', ') || 'none'}.`);
  }
  return { worker, entry: collector, kind, limits: limitsFrom(deps.env['DAILY_WRITE_LIMIT']), repo: options.repo };
}

type Plan = { kind: 'commits'; selection: Selection } | { kind: 'runs' };

/** Checks the options that depend on the kind of the metric. */
function plan({ kind, repo, entry }: Setup, options: BackfillOptions): Plan {
  if (kind === 'commits') {
    if (!options.selection) {
      throw new UsageError('Choose the commits with one of --tags, --every <n> and --refs <a,b,...>.');
    }
    return { kind, selection: options.selection };
  }
  if (!RUN_REPO.test(repo)) {
    throw new UsageError(`--repo "${repo}" must look like owner/name for a metric of runs.`);
  }
  if (options.selection || options.command !== undefined || options.branch !== undefined) {
    throw new UsageError('--tags, --every, --refs, --branch and --run are for a metric of commits. A metric of runs uses --since.');
  }
  const declared = entry.collector.inputs.map(({ name }) => name);
  if (!declared.includes('run-id') || !declared.includes('run-attempt')) {
    throw new UsageError(`The collector of ${options.metric} must have the inputs run-id and run-attempt to be backfilled.`);
  }
  return { kind };
}

async function listTargets(context: Setup, chosen: Plan, options: BackfillOptions, deps: BackfillDeps): Promise<Target[]> {
  if (chosen.kind === 'commits') {
    return listCommitTargets({ repo: context.repo, selection: chosen.selection, since: options.since, branch: options.branch });
  }
  const token = deps.env['GITHUB_TOKEN'];
  if (!token) {
    throw new UsageError('Set the GITHUB_TOKEN variable to list the runs.');
  }
  const now = (deps.now ?? (() => new Date()))();
  const since = options.since ?? retentionStart(now);
  if (since < retentionStart(now)) {
    deps.log('GitHub keeps the logs and the artifacts of a run for 90 days, so the list starts 90 days ago.');
  }
  return listRunTargets({ repo: context.repo, since, token, ...(deps.fetch ? { fetch: deps.fetch } : {}), now: () => now });
}

function describeTooLarge(label: string, cost: number, ceiling: number): string {
  return `The snapshot of ${label} needs ${cost} rows, and the backfill limit for one day is ${ceiling} rows, so it cannot be uploaded on any day. Use --every <n> to take fewer commits, or collect fewer folders.`;
}

interface Collected {
  pending: Pending[];
  skipped: number;
  tooLarge?: string;
}

/** A target that fails is skipped and tried again on the next run. A snapshot that is too large stops the collection. */
async function collectAll(context: Setup, options: BackfillOptions, deps: BackfillDeps, targets: Target[], cache: Cache): Promise<Collected> {
  const collected: Collected = { pending: [], skipped: 0 };
  const env = context.kind === 'runs' ? { ...deps.env, GITHUB_REPOSITORY: context.repo } : deps.env;
  for (const [index, target] of targets.entries()) {
    if (cache.isUploaded(target.key)) {
      continue;
    }
    try {
      let snapshot = await cache.read(target.key);
      if (snapshot === undefined) {
        deps.log(`Collect ${index + 1} of ${targets.length}: ${target.label}`);
        snapshot = await collectTarget({ entry: context.entry, target, repo: context.repo, command: options.command, inputs: options.inputs, env });
        await cache.write(target.key, snapshot);
      }
      const parsed = context.worker.metric.parse(snapshot);
      const cost = estimateCost(context.worker.store.toRows(parsed));
      if (cost > context.limits.backfillLimit) {
        collected.tooLarge = describeTooLarge(target.label, cost, context.limits.backfillLimit);
        return collected;
      }
      collected.pending.push({ target, snapshot: parsed, cost });
    } catch (error) {
      collected.skipped += 1;
      deps.log(`Skipped ${target.label}: ${(error as Error).message.slice(0, 600)}`);
    }
  }
  return collected;
}

const daysFor = (rows: number, limits: Limits): number => Math.max(1, Math.ceil(rows / limits.backfillLimit));
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;
const sumCost = (pending: readonly Pending[]): number => pending.reduce((total, item) => total + item.cost, 0);

function reportStop(stop: Stop, uploaded: number, total: number, limits: Limits, deps: BackfillDeps): BackfillStatus {
  if (stop.reason === 'too-large') {
    deps.log(describeTooLarge(stop.pending.target.label, stop.pending.cost, stop.ceiling));
    return 'too-large';
  }
  const when = stop.retryAfter === undefined ? 'after 00:00 UTC' : `after 00:00 UTC (in ${stop.retryAfter} seconds)`;
  deps.log(`Stopped by the write budget: ${uploaded} of ${total} targets are uploaded. Run the same command again ${when}. `
    + `About ${plural(daysFor(sumCost(stop.remaining), limits), 'more day')} are needed at ${limits.backfillLimit} rows for each day.`);
  return 'stopped';
}

function listPending(pending: readonly Pending[], limits: Limits, deps: BackfillDeps): void {
  for (const { target, cost } of pending) {
    deps.log(`${target.date.slice(0, 10)}  ${target.label}  ${cost} rows`);
  }
  deps.log(`${plural(pending.length, 'target')} to upload, ${sumCost(pending)} rows. At ${limits.backfillLimit} rows for each day, this needs about ${plural(daysFor(sumCost(pending), limits), 'day')}.`);
}

function destinationFrom(options: BackfillOptions, deps: BackfillDeps): UploadTarget | undefined {
  const url = (options.workerUrl ?? deps.env['DEVANALYTICS_URL'])?.replace(/\/+$/, '');
  const token = deps.env['DEVANALYTICS_INGEST_TOKEN'];
  if (url && token) {
    return { url, token };
  }
  if (!options.dryRun) {
    throw new InputError('Set the DEVANALYTICS_URL and DEVANALYTICS_INGEST_TOKEN variables, or use --dry-run.');
  }
  return undefined;
}

const OK_STATUSES: readonly BackfillStatus[] = ['done', 'stopped', 'dry-run'];

function resultFor(total: number) {
  return (status: BackfillStatus, uploaded: number, skipped = 0): BackfillResult => ({ status, uploaded, total, skipped, exitCode: OK_STATUSES.includes(status) ? 0 : 1 });
}

interface UploadPhase {
  context: Setup;
  options: BackfillOptions;
  deps: BackfillDeps;
  destination: UploadTarget;
  cache: Cache;
  collected: Collected;
  total: number;
  alreadyUploaded: number;
}

async function uploadPhase({ context, options, deps, destination, cache, collected, total, alreadyUploaded }: UploadPhase): Promise<BackfillResult> {
  const result = resultFor(total);
  const summary = await uploadAll(collected.pending, {
    destination,
    metric: options.metric,
    cache,
    log: deps.log,
    ...(deps.uploadOptions ? { uploadOptions: deps.uploadOptions } : {}),
  });
  const uploaded = alreadyUploaded + summary.sent;
  if (summary.stop) {
    return result(reportStop(summary.stop, uploaded, total, context.limits, deps), uploaded, collected.skipped);
  }
  const note = collected.skipped > 0 ? ` ${plural(collected.skipped, 'target')} were skipped and are tried again on the next run.` : '';
  deps.log(`Done: ${uploaded} of ${total} targets are uploaded, ${summary.rowsWritten} rows written in this run.${note}`);
  return result('done', uploaded, collected.skipped);
}

/**
 * Lists the targets, collects each one into the cache, and uploads them oldest first until the budget stops it.
 * A dry run does everything but the upload, so the next run finds the snapshots in the cache.
 */
export async function runBackfill(options: BackfillOptions, deps: BackfillDeps): Promise<BackfillResult> {
  const context = setup(options, deps);
  const chosen = plan(context, options);
  const destination = destinationFrom(options, deps);

  const targets = await listTargets(context, chosen, options, deps);
  const result = resultFor(targets.length);
  if (targets.length === 0) {
    deps.log('No target found.');
    return result('no-targets', 0);
  }
  const cache = await openCache(options.dir, options.metric, destination?.url);
  const alreadyUploaded = targets.filter(({ key }) => cache.isUploaded(key)).length;
  deps.log(`${plural(targets.length, 'target')} found, ${alreadyUploaded} already uploaded.`);

  const collected = await collectAll(context, options, deps, targets, cache);
  if (collected.tooLarge) {
    deps.log(`${collected.tooLarge} Nothing more was uploaded.`);
    return result('too-large', alreadyUploaded, collected.skipped);
  }
  if (collected.pending.length === 0 && collected.skipped > 0) {
    deps.log(`Every target that is not uploaded was skipped (${collected.skipped}).`);
    return result('failed', alreadyUploaded, collected.skipped);
  }
  if (options.dryRun || !destination) {
    listPending(collected.pending, context.limits, deps);
    return result('dry-run', alreadyUploaded, collected.skipped);
  }
  return uploadPhase({ context, options, deps, destination, cache, collected, total: targets.length, alreadyUploaded });
}
