import { readFile } from 'node:fs/promises';

export interface RunInfo {
  id: number;
  attempt: number;
  /** The start of the run attempt, in ISO 8601. */
  startedAt: string;
}

interface Defaults {
  id: string | undefined;
  attempt: string | undefined;
  startedAt: string | undefined;
}

type Env = Readonly<Record<string, string | undefined>>;

function positive(name: string, value: string | undefined): number {
  const number = Number(value);
  if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive whole number, and it is "${value ?? ''}".`);
  }
  return number;
}

/** In a `workflow_run` workflow, the event names the run that was tested. Any other event names the current run. */
async function readDefaults(env: Env): Promise<Defaults> {
  if (env['GITHUB_EVENT_NAME'] === 'workflow_run' && env['GITHUB_EVENT_PATH']) {
    const { workflow_run: run } = JSON.parse(await readFile(env['GITHUB_EVENT_PATH'], 'utf8')) as {
      workflow_run?: { id?: number; run_attempt?: number; run_started_at?: string | null; created_at?: string };
    };
    return {
      id: run?.id === undefined ? undefined : String(run.id),
      attempt: run?.run_attempt === undefined ? undefined : String(run.run_attempt),
      startedAt: run?.run_started_at ?? run?.created_at,
    };
  }
  return { id: env['GITHUB_RUN_ID'], attempt: env['GITHUB_RUN_ATTEMPT'], startedAt: undefined };
}

async function fetchStart(env: Env, token: string, id: number, attempt: number): Promise<string> {
  const repository = env['GITHUB_REPOSITORY'];
  if (!repository) {
    throw new Error('Set GITHUB_REPOSITORY, or set run-started-at, to know when the run started.');
  }
  const apiUrl = (env['GITHUB_API_URL'] || 'https://api.github.com').replace(/\/+$/, '');
  const route = `/repos/${repository}/actions/runs/${id}/attempts/${attempt}`;
  const response = await fetch(`${apiUrl}${route}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for ${route}: ${(await response.text()).slice(0, 300)}`);
  }
  const run = await response.json() as { run_started_at?: string | null; created_at?: string };
  return run.run_started_at ?? run.created_at ?? '';
}

function resolveStart(inputs: Readonly<Record<string, string>>, env: Env, defaults: Defaults, id: number, attempt: number): Promise<string | undefined> | string | undefined {
  if (inputs['run-started-at']) {
    return inputs['run-started-at'];
  }
  if (String(id) === defaults.id && String(attempt) === defaults.attempt && defaults.startedAt) {
    return defaults.startedAt;
  }
  return inputs['github-token'] ? fetchStart(env, inputs['github-token'], id, attempt) : undefined;
}

/**
 * Finds the run to record. An input wins. Without one, the `workflow_run` event gives the run, the attempt and the start.
 * Without that event, the current run gives the id and the attempt, and the GitHub API gives the start.
 */
export async function resolveRun(inputs: Readonly<Record<string, string>>, env: Env): Promise<RunInfo> {
  const defaults = await readDefaults(env);
  const id = positive('run-id', inputs['run-id'] ?? defaults.id);
  const attempt = positive('run-attempt', inputs['run-attempt'] ?? (String(id) === defaults.id ? defaults.attempt : undefined));
  const startedAt = await resolveStart(inputs, env, defaults, id, attempt);
  if (!startedAt || Number.isNaN(Date.parse(startedAt))) {
    throw new Error('The start time of the run is not known. Set run-started-at, or set github-token so that the collector reads it from GitHub.');
  }
  return { id, attempt, startedAt };
}
