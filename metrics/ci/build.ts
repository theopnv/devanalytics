import type { CiJob, CiSnapshot, OSES } from './metric.ts';
import type { LogGroup } from './log-groups.ts';

/** The parts of a workflow run from the GitHub API that the snapshot needs. */
export interface ApiRun {
  id: number;
  run_attempt: number;
  name: string;
  event: string;
  head_sha: string;
  head_branch: string | null;
  conclusion: string | null;
  created_at: string;
  run_started_at?: string | null;
  updated_at: string;
}

export interface ApiStep {
  name: string;
  number: number;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface ApiJob {
  id: number;
  name: string;
  conclusion: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  labels: string[];
  steps?: ApiStep[];
}

type Os = (typeof OSES)[number];

/** Whole seconds between two timestamps, or null when one is missing or the end is not after the start. */
export function secondsBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) {
    return null;
  }
  const milliseconds = Date.parse(to) - Date.parse(from);
  return Number.isNaN(milliseconds) ? null : Math.max(0, Math.round(milliseconds / 1000));
}

export function osOf(runner: string): Os {
  if (runner.startsWith('ubuntu')) {
    return 'linux';
  }
  if (runner.startsWith('macos')) {
    return 'macos';
  }
  return runner.startsWith('windows') ? 'windows' : 'other';
}

function snapshotJob(job: ApiJob, groups: readonly LogGroup[]): CiJob {
  const runner = job.labels[0] ?? '';
  return {
    id: job.id,
    name: job.name,
    runner,
    os: osOf(runner),
    conclusion: job.conclusion ?? 'unknown',
    queue_seconds: secondsBetween(job.created_at, job.started_at),
    duration_seconds: secondsBetween(job.started_at, job.completed_at),
    steps: (job.steps ?? []).map((step) => ({
      number: step.number,
      name: step.name,
      conclusion: step.conclusion ?? 'unknown',
      // GitHub gives a skipped step the time of its neighbor, so a duration would be noise.
      duration_seconds: step.conclusion === 'skipped' ? null : secondsBetween(step.started_at, step.completed_at),
    })),
    groups: [...groups],
  };
}

/** Joins a run, its jobs and the log groups of each job (by job id). */
export function buildSnapshot(
  run: ApiRun,
  apiJobs: ApiJob[],
  groups: ReadonlyMap<number, readonly LogGroup[]> = new Map(),
  labels: Record<string, string> = {},
): CiSnapshot {
  const start = run.run_started_at ?? run.created_at;
  return {
    run_id: run.id,
    run_attempt: run.run_attempt,
    date: start,
    sha: run.head_sha,
    workflow: run.name,
    event: run.event,
    branch: run.head_branch ?? 'unknown',
    conclusion: run.conclusion ?? 'unknown',
    wall_seconds: secondsBetween(start, run.updated_at) ?? 0,
    ...(Object.keys(labels).length > 0 && { labels }),
    jobs: apiJobs.map((job) => snapshotJob(job, groups.get(job.id) ?? [])),
  };
}
