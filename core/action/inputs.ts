import type { InputSpec } from '../contract.ts';

export type Env = Readonly<Record<string, string | undefined>>;

export interface CoreInputs {
  metric: string;
  workerUrl: string;
  token: string;
  workingDirectory: string;
}

export class InputError extends Error {
  override name = 'InputError';
}

/** The runner passes each `with:` entry as `INPUT_<NAME>`: upper case, spaces become underscores, hyphens stay. */
export function inputVariable(name: string): string {
  return `INPUT_${name.replaceAll(' ', '_').toUpperCase()}`;
}

export function readInput(env: Env, name: string): string {
  return (env[inputVariable(name)] ?? '').trim();
}

function parseWorkerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InputError(`worker-url "${value}" is not a URL. Set the DEVANALYTICS_URL variable to the address of the Worker.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InputError('worker-url must start with https://.');
  }
  return value.replace(/\/+$/, '');
}

/** Checks the credentials before any collection starts, so a missing secret fails fast. */
export function readCoreInputs(env: Env): CoreInputs {
  const metric = readInput(env, 'metric');
  if (!metric) {
    throw new InputError('Set the metric input.');
  }
  const token = readInput(env, 'token');
  if (!token) {
    throw new InputError("Set the DEVANALYTICS_INGEST_TOKEN secret to the Worker's INGEST_TOKEN, and pass it in the token input.");
  }
  const workerUrl = readInput(env, 'worker-url');
  if (!workerUrl) {
    throw new InputError('Set the DEVANALYTICS_URL variable to the address of the Worker, and pass it in the worker-url input.');
  }
  return { metric, token, workerUrl: parseWorkerUrl(workerUrl), workingDirectory: readInput(env, 'working-directory') || '.' };
}

/** An input that has no value and no default is left out. */
export function readMetricInputs(specs: readonly InputSpec[], env: Env): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const { name, default: fallback } of specs) {
    const value = readInput(env, name) || fallback;
    if (value) {
      inputs[name] = value;
    }
  }
  return inputs;
}
