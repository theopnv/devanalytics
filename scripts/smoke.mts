import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inputVariable, readMetricInputs } from '../core/action/inputs.ts';
import type { WorkerEntry } from '../core/contract.ts';
import { snapshotKey } from '../core/worker/replace.ts';
import { buildAction } from './build-action.mts';
import { run, startDevWorker } from './dev-worker.mts';
import type { DevWorker } from './dev-worker.mts';
import { loadRegistries } from './registries.mts';
import type { Registries } from './registries.mts';
import { sync } from './sync.mts';

const root = path.resolve(import.meta.dirname, '..');

/** The fixtures folder can hold `inputs.json`, an object with the input values of the metric. */
async function fixtureInputs(folder: string): Promise<Record<string, string>> {
  const text = await readFile(path.join(folder, 'inputs.json'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return '{}';
    }
    throw error;
  });
  return JSON.parse(text) as Record<string, string>;
}

async function countRows(worker: DevWorker, metric: string, table: string, key: ReturnType<typeof snapshotKey>): Promise<number> {
  const response = await fetch(`${worker.url}/v1/${metric}/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${worker.queryToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: `SELECT count(*) AS n FROM ${table} WHERE ${key.where}`, params: key.values }),
  });
  const body = await response.json() as { rows?: { n: number }[]; error?: string };
  if (!response.ok || !body.rows?.[0]) {
    throw new Error(`The query on ${table} failed with ${response.status}: ${body.error ?? JSON.stringify(body)}`);
  }
  return body.rows[0].n;
}

async function readCounts(worker: DevWorker, entry: WorkerEntry, expected: Map<string, number>, key: ReturnType<typeof snapshotKey>): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of entry.store.tables) {
    counts.set(table, await countRows(worker, entry.metric.name, table, key));
  }
  for (const [table, count] of counts) {
    if (count !== expected.get(table)) {
      throw new Error(`${table} has ${count} rows for the snapshot, and the collector made ${expected.get(table) ?? 0}.`);
    }
  }
  return counts;
}

async function smokeMetric(dev: DevWorker, name: string, { workers, collectors }: Registries): Promise<string> {
  const worker = workers.find((entry) => entry.metric.name === name);
  const collector = collectors.find((entry) => entry.metric.name === name);
  if (!worker || !collector) {
    throw new Error(`There is no metric named ${name}. The metrics are: ${workers.map((entry) => entry.metric.name).join(', ')}.`);
  }

  const fixtures = path.join(root, 'metrics', name, 'fixtures');
  const inputs = await fixtureInputs(fixtures);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [inputVariable('metric')]: name,
    [inputVariable('worker-url')]: dev.url,
    [inputVariable('token')]: dev.ingestToken,
    [inputVariable('working-directory')]: path.relative(root, fixtures),
    ...Object.fromEntries(Object.entries(inputs).map(([input, value]) => [inputVariable(input), value])),
  };

  const collected = await collector.collector.collect({ inputs: readMetricInputs(collector.collector.inputs, env), cwd: fixtures, env });
  const snapshot = worker.metric.parse(collected);
  const expected = new Map<string, number>(worker.store.tables.map((table) => [table, 0]));
  for (const { table, rows } of worker.store.toRows(snapshot)) {
    expected.set(table, (expected.get(table) ?? 0) + rows.length);
  }
  const key = snapshotKey(worker.metric.key, snapshot);

  // The second run proves that an ingest of the same key replaces its rows.
  let counts = new Map<string, number>();
  for (const attempt of [1, 2]) {
    const result = await run(process.execPath, [path.join(root, 'action', 'dist', 'index.js')], root, env);
    if (result.code !== 0) {
      throw new Error(`The Action failed on run ${attempt}:\n${result.output}`);
    }
    counts = await readCounts(dev, worker, expected, key);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    throw new Error('The fixtures make a snapshot with no rows, so the smoke test proves nothing.');
  }
  return [...counts].map(([table, count]) => `${count} in ${table}`).join(', ');
}

async function main(names: string[]): Promise<void> {
  if (names.length === 0) {
    throw new Error('Usage: npm run smoke -- <metric>…');
  }
  await sync(root);
  await buildAction(root);
  const registries = await loadRegistries(root);

  const dev = await startDevWorker({ root });
  try {
    for (const name of names) {
      process.stdout.write(`smoke: ${name} ok (${await smokeMetric(dev, name, registries)})\n`);
    }
  } finally {
    await dev.stop();
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`smoke: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
