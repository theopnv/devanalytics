import { readFile } from 'node:fs/promises';

type Env = Readonly<Record<string, string | undefined>>;

export interface RunIds {
  id: number;
  attempt: number;
}

function positive(name: string, value: string | undefined): number {
  const number = Number(value);
  if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive whole number, and it is "${value ?? ''}".`);
  }
  return number;
}

/** In a `workflow_run` workflow, the event names the run that was tested. Any other event names the current run. */
async function readDefaults(env: Env): Promise<{ id: string | undefined; attempt: string | undefined }> {
  if (env['GITHUB_EVENT_NAME'] === 'workflow_run' && env['GITHUB_EVENT_PATH']) {
    const { workflow_run: run } = JSON.parse(await readFile(env['GITHUB_EVENT_PATH'], 'utf8')) as { workflow_run?: { id?: number; run_attempt?: number } };
    return { id: run?.id === undefined ? undefined : String(run.id), attempt: run?.run_attempt === undefined ? undefined : String(run.run_attempt) };
  }
  return { id: env['GITHUB_RUN_ID'], attempt: env['GITHUB_RUN_ATTEMPT'] };
}

/** An input wins. Without one, the `workflow_run` event gives the run and the attempt, and without that event the current run does. */
export async function resolveRunIds(inputs: Readonly<Record<string, string>>, env: Env): Promise<RunIds> {
  const defaults = await readDefaults(env);
  const id = positive('run-id', inputs['run-id'] ?? defaults.id);
  const attempt = positive('run-attempt', inputs['run-attempt'] ?? (String(id) === defaults.id ? defaults.attempt : undefined));
  return { id, attempt };
}
