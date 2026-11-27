import path from 'node:path';
import { ValidationError } from '../contract.ts';
import type { CollectorEntry, Snapshot } from '../contract.ts';
import { InputError, readCoreInputs, readMetricInputs } from './inputs.ts';
import type { Env } from './inputs.ts';
import { upload } from './upload.ts';
import type { UploadOptions } from './upload.ts';

export interface RunDeps {
  log(line: string): void;
  /** The folder that `working-directory` is relative to. */
  cwd?: string;
  uploadOptions?: UploadOptions;
}

function describeKey(snapshot: Snapshot): string {
  return 'sha' in snapshot ? snapshot.sha : `run ${snapshot.run_id} attempt ${snapshot.run_attempt}`;
}

function findEntry(registry: readonly CollectorEntry[], name: string): CollectorEntry {
  const entry = registry.find(({ metric }) => metric.name === name);
  if (!entry) {
    const names = registry.map(({ metric }) => metric.name).join(', ') || 'none';
    throw new InputError(`Unknown metric "${name}". The metrics in this version are: ${names}.`);
  }
  return entry;
}

/** Collects one snapshot of the metric named in the inputs and uploads it. Every failure throws, and the caller fails the step. */
export async function runAction(registry: readonly CollectorEntry[], env: Env, deps: RunDeps): Promise<void> {
  const core = readCoreInputs(env);
  const { metric, collector } = findEntry(registry, core.metric);
  const cwd = path.resolve(deps.cwd ?? process.cwd(), core.workingDirectory);

  const collected = await collector.collect({ inputs: readMetricInputs(collector.inputs, env), cwd, env });
  let snapshot: Snapshot;
  try {
    snapshot = metric.parse(collected);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new Error(`The ${metric.name} collector made a snapshot that is not valid: ${error.message}`, { cause: error });
    }
    throw error;
  }

  const { rowsWritten } = await upload({ url: core.workerUrl, token: core.token }, metric.name, snapshot, deps.uploadOptions);
  deps.log(`${metric.name}: uploaded ${describeKey(snapshot)}, ${rowsWritten} rows written.`);
}
