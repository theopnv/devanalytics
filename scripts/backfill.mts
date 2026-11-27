import path from 'node:path';
import { InputError } from '../core/action/inputs.ts';
import { parseBackfillArgs, USAGE, UsageError } from '../core/backfill/args.ts';
import { runBackfill } from '../core/backfill/run.ts';
import { loadRegistries } from './registries.mts';

const root = path.resolve(import.meta.dirname, '..');

try {
  const options = parseBackfillArgs(process.argv.slice(2));
  const { workers, collectors } = await loadRegistries(root);
  const result = await runBackfill(options, { workers, collectors, env: process.env, log: (line) => process.stdout.write(`${line}\n`) });
  process.exitCode = result.exitCode;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`backfill: ${message}\n`);
  if (error instanceof UsageError) {
    process.stderr.write(`\n${USAGE}\n`);
  }
  process.exitCode = error instanceof UsageError || error instanceof InputError ? 2 : 1;
}
