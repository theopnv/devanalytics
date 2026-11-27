import process from 'node:process';
import { runAction } from '../../core/action/run.ts';
import { collectorRegistry } from './generated/collector-registry.ts';

// A workflow command ends at a line break, so the message must not contain one.
const escapeCommand = (message: string): string => message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

runAction(collectorRegistry, process.env, { log: (line) => process.stdout.write(`${line}\n`) }).catch((error: unknown) => {
  process.stdout.write(`::error::${escapeCommand(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
