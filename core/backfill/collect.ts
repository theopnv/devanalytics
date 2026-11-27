import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inputVariable, readMetricInputs } from '../action/inputs.ts';
import type { CollectorEntry, Snapshot } from '../contract.ts';
import { inWorktree } from './git.ts';
import type { Target } from './targets.ts';

const OUTPUT_TAIL = 2000;

export interface CollectJob {
  entry: CollectorEntry;
  target: Target;
  /** A path for a `commits` metric, and `owner/name` for a `runs` metric. */
  repo: string;
  /** A shell command that runs in the worktree before the collection. */
  command?: string | undefined;
  /** The `--input name=value` pairs. */
  inputs: Record<string, string>;
  env: Readonly<Record<string, string | undefined>>;
}

/** The string that names a snapshot in the cache and in `state.json`. */
export function snapshotId(snapshot: Snapshot): string {
  return 'sha' in snapshot ? snapshot.sha : `${snapshot.run_id}-${snapshot.run_attempt}`;
}

function runCommand(command: string, cwd: string, env: CollectJob['env']): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const keep = (chunk: Buffer): void => {
      output = (output + chunk.toString()).slice(-OUTPUT_TAIL);
    };
    const child = spawn(command, { cwd, env: env as NodeJS.ProcessEnv, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`the command "${command}" ended with code ${code}:\n${output.trim()}`));
      }
    });
  });
}

/** The inputs of the target, then the `--input` pairs, then the defaults of the collector. A collector gets `github-token` from `GITHUB_TOKEN`. */
export function collectorInputs({ entry, target, inputs, env }: CollectJob): Record<string, string> {
  const values: Record<string, string | undefined> = { 'github-token': env['GITHUB_TOKEN'], ...target.inputs, ...inputs };
  const declared = new Set(entry.collector.inputs.map(({ name }) => name));
  const variables = Object.fromEntries(Object.entries(values).filter(([name]) => declared.has(name)).map(([name, value]) => [inputVariable(name), value]));
  return readMetricInputs(entry.collector.inputs, variables);
}

async function collectIn(job: CollectJob, cwd: string): Promise<Snapshot> {
  if (job.command) {
    await runCommand(job.command, cwd, job.env);
  }
  const snapshot = await job.entry.collector.collect({ inputs: collectorInputs(job), cwd, env: job.env });
  return job.entry.metric.parse(snapshot);
}

/** Collects the snapshot of one target, and checks that it is the snapshot of that target. */
export async function collectTarget(job: CollectJob): Promise<Snapshot> {
  const { target } = job;
  let snapshot: Snapshot;
  if (target.sha === undefined) {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-run-'));
    try {
      snapshot = await collectIn(job, cwd);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  } else {
    snapshot = await inWorktree(job.repo, target.sha, (cwd) => collectIn(job, cwd));
  }
  const id = snapshotId(snapshot);
  if (id !== target.key) {
    throw new Error(`the collector made the snapshot of ${id}, and the target is ${target.key}. A collector must read the key from the checkout or from its inputs.`);
  }
  return snapshot;
}
