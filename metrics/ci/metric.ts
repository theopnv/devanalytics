import { ValidationError } from '../../core/contract.ts';
import type { Metric, RunSnapshot } from '../../core/contract.ts';
import { expectDate, expectInteger, expectList, expectNullableInteger, expectObject, expectOneOf, expectSha, expectText } from '../../core/worker/expect.ts';

export const OSES = ['linux', 'macos', 'windows', 'other'] as const;

export const MAX_JOBS = 256;
export const MAX_STEPS = 200;
export const MAX_GROUPS = 200;
export const MAX_LABELS = 20;
export const MAX_LABEL_VALUE = 200;
/** The name of a label key. */
export const LABEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface CiStep {
  number: number;
  name: string;
  conclusion: string;
  /** Null for a step that did not run. */
  duration_seconds: number | null;
}

/** A section of a job log, from its `##[group]` line to the next one. */
export interface CiGroup {
  name: string;
  duration_ms: number;
}

export interface CiJob {
  id: number;
  name: string;
  runner: string;
  os: (typeof OSES)[number];
  conclusion: string;
  queue_seconds: number | null;
  duration_seconds: number | null;
  steps: CiStep[];
  groups: CiGroup[];
}

export interface CiSnapshot extends RunSnapshot {
  /** The commit that the run tested. */
  sha: string;
  workflow: string;
  event: string;
  branch: string;
  conclusion: string;
  wall_seconds: number;
  /** Free `key=value` pairs from the user, stored as JSON text. */
  labels?: Record<string, string>;
  jobs: CiJob[];
}

function parseStep(value: unknown, field: string): CiStep {
  const step = expectObject(value, field);
  return {
    number: expectInteger(step['number'], `${field}.number`),
    name: expectText(step['name'], `${field}.name`),
    conclusion: expectText(step['conclusion'], `${field}.conclusion`),
    duration_seconds: expectNullableInteger(step['duration_seconds'], `${field}.duration_seconds`),
  };
}

function parseGroup(value: unknown, field: string): CiGroup {
  const group = expectObject(value, field);
  return {
    name: expectText(group['name'], `${field}.name`),
    duration_ms: expectInteger(group['duration_ms'], `${field}.duration_ms`),
  };
}

/** A job that never started has no runner label, so the text can be empty. */
function parseRunner(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 1000) {
    throw new ValidationError(`${field} must be a string of at most 1000 characters`);
  }
  return value;
}

function parseJob(value: unknown, index: number): CiJob {
  const field = `jobs[${index}]`;
  const job = expectObject(value, field);
  return {
    id: expectInteger(job['id'], `${field}.id`),
    name: expectText(job['name'], `${field}.name`),
    runner: parseRunner(job['runner'], `${field}.runner`),
    os: expectOneOf(job['os'], `${field}.os`, OSES),
    conclusion: expectText(job['conclusion'], `${field}.conclusion`),
    queue_seconds: expectNullableInteger(job['queue_seconds'], `${field}.queue_seconds`),
    duration_seconds: expectNullableInteger(job['duration_seconds'], `${field}.duration_seconds`),
    steps: expectList(job['steps'], `${field}.steps`, MAX_STEPS).map((step, i) => parseStep(step, `${field}.steps[${i}]`)),
    groups: expectList(job['groups'], `${field}.groups`, MAX_GROUPS).map((group, i) => parseGroup(group, `${field}.groups[${i}]`)),
  };
}

function parseLabels(value: unknown): Record<string, string> {
  const labels = expectObject(value, 'labels');
  const keys = Object.keys(labels);
  if (keys.length > MAX_LABELS) {
    throw new ValidationError(`labels must have at most ${MAX_LABELS} entries`);
  }
  return Object.fromEntries(keys.map((key) => {
    const text = labels[key];
    if (!LABEL_KEY.test(key) || typeof text !== 'string' || text.length > MAX_LABEL_VALUE) {
      throw new ValidationError(`labels.${key} must have a key of letters, digits, ".", "_" and "-", and a text value of at most ${MAX_LABEL_VALUE} characters`);
    }
    return [key, text];
  }));
}

export const metric: Metric<CiSnapshot> = {
  name: 'ci',
  key: 'run',
  parse(body) {
    const snapshot = expectObject(body, 'snapshot');
    const labels = snapshot['labels'] === undefined ? undefined : parseLabels(snapshot['labels']);
    return {
      run_id: expectInteger(snapshot['run_id'], 'run_id'),
      run_attempt: expectInteger(snapshot['run_attempt'], 'run_attempt'),
      date: expectDate(snapshot['date']),
      sha: expectSha(snapshot['sha']),
      workflow: expectText(snapshot['workflow'], 'workflow'),
      event: expectText(snapshot['event'], 'event'),
      branch: expectText(snapshot['branch'], 'branch'),
      conclusion: expectText(snapshot['conclusion'], 'conclusion'),
      wall_seconds: expectInteger(snapshot['wall_seconds'], 'wall_seconds'),
      ...(labels && { labels }),
      jobs: expectList(snapshot['jobs'], 'jobs', MAX_JOBS).map(parseJob),
    };
  },
};
