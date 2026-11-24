/** A snapshot body that fails validation. The Worker answers 400. */
export class ValidationError extends Error {
  override name = 'ValidationError';
}

/** The key of a `commit` metric. `date` is the commit date, never the upload time. */
export interface CommitSnapshot {
  sha: string;
  date: string;
}

/** The key of a `run` metric. `date` is the run start time, never the upload time. */
export interface RunSnapshot {
  run_id: number;
  run_attempt: number;
  date: string;
}

export type Snapshot = CommitSnapshot | RunSnapshot;

export type MetricKey = 'commit' | 'run';

export interface Metric<S extends Snapshot> {
  /** URL segment and table prefix. Lowercase letters and digits only. */
  name: string;
  key: MetricKey;
  /** Throws ValidationError. */
  parse(body: unknown): S;
}

/** The insert binds the key columns first (`sha`, `date`, or `run_id`, `run_attempt`, `date`) and the JSON array of `rows` last. */
export interface TableRows {
  table: string;
  insert: string;
  rows: unknown[][];
}

/** The `schemaVersion: 1` JSON that shields.io reads. */
export interface ShieldsEndpoint {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  isError?: boolean;
}

export interface Store<S extends Snapshot> {
  /** The query allow list. Each name starts with `<metric name>_`. */
  tables: string[];
  toRows(snapshot: S): TableRows[];
  badge?(db: D1Database, params: URLSearchParams): Promise<ShieldsEndpoint>;
}

export interface InputSpec {
  name: string;
  description: string;
  default?: string;
}

export interface CollectContext {
  /** Values of the metric inputs, with the defaults applied. */
  inputs: Readonly<Record<string, string>>;
  /** The repository folder to read. A temporary worktree in a backfill. */
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
}

export interface Collector<S extends Snapshot> {
  inputs: InputSpec[];
  collect(ctx: CollectContext): Promise<S>;
  /** How the backfill command lists old data. */
  backfill?: 'commits' | 'runs';
}

/** The generated Worker registry holds one of these for each folder in `metrics/`. */
export interface WorkerEntry {
  metric: Metric<Snapshot>;
  store: Store<Snapshot>;
}

/** The generated Action registry holds one of these for each folder in `metrics/`. */
export interface CollectorEntry {
  metric: Metric<Snapshot>;
  collector: Collector<Snapshot>;
}
