import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inputVariable, readMetricInputs } from '../core/action/inputs.ts';
import type { CollectorEntry, WorkerEntry } from '../core/contract.ts';
import { snapshotKey } from '../core/worker/replace.ts';
import { buildAction } from './build-action.mts';
import { sync } from './sync.mts';

const INGEST_TOKEN = 'smoke-ingest-token';
const QUERY_TOKEN = 'smoke-query-token';
const START_TIMEOUT = 60_000;

const root = path.resolve(import.meta.dirname, '..');
const wrangler = path.join(root, 'node_modules', '.bin', 'wrangler');

interface Registries {
  workers: readonly WorkerEntry[];
  collectors: readonly CollectorEntry[];
}

interface Child {
  process: ChildProcess;
  output: () => string;
  exit: Promise<number | null>;
}

function start(command: string, args: string[], env: NodeJS.ProcessEnv = process.env, cwd = root): Child {
  let log = '';
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk: Buffer) => { log += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { log += chunk.toString(); });
  const exit = new Promise<number | null>((resolve) => {
    child.on('close', resolve);
  });
  return { process: child, output: () => log, exit };
}

async function run(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  const child = start(command, args, env);
  const code = await child.exit;
  return { code, output: child.output() };
}

function stop(child: Child): void {
  if (child.process.pid !== undefined && child.process.exitCode === null) {
    process.kill(-child.process.pid, 'SIGTERM');
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function waitForWorker(url: string, dev: Child): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT;
  while (Date.now() < deadline) {
    if (dev.process.exitCode !== null) {
      throw new Error(`wrangler dev stopped before it was ready:\n${dev.output()}`);
    }
    try {
      await fetch(`${url}/v1/usage`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`wrangler dev was not ready after ${START_TIMEOUT / 1000} seconds:\n${dev.output()}`);
}

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

async function countRows(url: string, metric: string, table: string, key: ReturnType<typeof snapshotKey>): Promise<number> {
  const response = await fetch(`${url}/v1/${metric}/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${QUERY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: `SELECT count(*) AS n FROM ${table} WHERE ${key.where}`, params: key.values }),
  });
  const body = await response.json() as { rows?: { n: number }[]; error?: string };
  if (!response.ok || !body.rows?.[0]) {
    throw new Error(`The query on ${table} failed with ${response.status}: ${body.error ?? JSON.stringify(body)}`);
  }
  return body.rows[0].n;
}

async function readCounts(url: string, entry: WorkerEntry, expected: Map<string, number>, key: ReturnType<typeof snapshotKey>): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of entry.store.tables) {
    counts.set(table, await countRows(url, entry.metric.name, table, key));
  }
  for (const [table, count] of counts) {
    if (count !== expected.get(table)) {
      throw new Error(`${table} has ${count} rows for the snapshot, and the collector made ${expected.get(table) ?? 0}.`);
    }
  }
  return counts;
}

async function smokeMetric(url: string, name: string, { workers, collectors }: Registries): Promise<string> {
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
    [inputVariable('worker-url')]: url,
    [inputVariable('token')]: INGEST_TOKEN,
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
    const result = await run(process.execPath, [path.join(root, 'action', 'dist', 'index.js')], env);
    if (result.code !== 0) {
      throw new Error(`The Action failed on run ${attempt}:\n${result.output}`);
    }
    counts = await readCounts(url, worker, expected, key);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    throw new Error('The fixtures make a snapshot with no rows, so the smoke test proves nothing.');
  }
  return [...counts].map(([table, count]) => `${count} in ${table}`).join(', ');
}

async function loadRegistries(): Promise<Registries> {
  const toUrl = (file: string): string => pathToFileURL(path.join(root, file)).href;
  const { workerRegistry } = await import(toUrl('src/generated/worker-registry.ts')) as { workerRegistry: readonly WorkerEntry[] };
  const { collectorRegistry } = await import(toUrl('action/src/generated/collector-registry.ts')) as { collectorRegistry: readonly CollectorEntry[] };
  return { workers: workerRegistry, collectors: collectorRegistry };
}

async function main(names: string[]): Promise<void> {
  if (names.length === 0) {
    throw new Error('Usage: npm run smoke -- <metric>…');
  }
  await sync(root);
  await buildAction(root);
  const registries = await loadRegistries();

  const state = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-smoke-'));
  let dev: Child | undefined;
  try {
    const migrated = await run(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state]);
    if (migrated.code !== 0) {
      throw new Error(`The migrations failed:\n${migrated.output}`);
    }
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    dev = start(wrangler, [
      'dev', '--port', String(port), '--inspector-port', String(await freePort()), '--persist-to', state,
      '--var', `INGEST_TOKEN:${INGEST_TOKEN}`, '--var', `QUERY_TOKEN:${QUERY_TOKEN}`,
    ]);
    await waitForWorker(url, dev);

    for (const name of names) {
      process.stdout.write(`smoke: ${name} ok (${await smokeMetric(url, name, registries)})\n`);
    }
  } finally {
    if (dev) {
      stop(dev);
    }
    await rm(state, { recursive: true, force: true });
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`smoke: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
