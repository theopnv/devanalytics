import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const START_TIMEOUT = 60_000;

export interface Child {
  process: ChildProcess;
  output: () => string;
  exit: Promise<number | null>;
}

export interface DevWorker {
  url: string;
  ingestToken: string;
  queryToken: string;
  /** Runs one SQL statement on the local D1 of the Worker. */
  execute(sql: string): Promise<void>;
  stop(): Promise<void>;
}

export interface DevWorkerOptions {
  root: string;
  /** Extra variables for the Worker, such as `DAILY_WRITE_LIMIT`. */
  vars?: Record<string, string>;
}

/** A process group leader, so that `stop` also ends the `workerd` child of `wrangler`. */
export function start(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Child {
  let log = '';
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk: Buffer) => { log += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { log += chunk.toString(); });
  const exit = new Promise<number | null>((resolve) => {
    child.on('close', resolve);
  });
  return { process: child, output: () => log, exit };
}

export async function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  const child = start(command, args, cwd, env);
  const code = await child.exit;
  return { code, output: child.output() };
}

function stopChild(child: Child): void {
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

/** Applies the committed `migrations/` to a temporary local D1 and starts `wrangler dev` on it. */
export async function startDevWorker({ root, vars = {} }: DevWorkerOptions): Promise<DevWorker> {
  const wrangler = path.join(root, 'node_modules', '.bin', 'wrangler');
  const ingestToken = 'dev-ingest-token';
  const queryToken = 'dev-query-token';
  const state = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-worker-'));
  let dev: Child | undefined;
  let url: string;
  try {
    const migrated = await run(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state], root);
    if (migrated.code !== 0) {
      throw new Error(`The migrations failed:\n${migrated.output}`);
    }
    const port = await freePort();
    url = `http://127.0.0.1:${port}`;
    const variables = { INGEST_TOKEN: ingestToken, QUERY_TOKEN: queryToken, ...vars };
    dev = start(wrangler, [
      'dev', '--port', String(port), '--inspector-port', String(await freePort()), '--persist-to', state,
      ...Object.entries(variables).flatMap(([name, value]) => ['--var', `${name}:${value}`]),
    ], root);
    await waitForWorker(url, dev);
  } catch (error) {
    if (dev) {
      stopChild(dev);
    }
    await rm(state, { recursive: true, force: true });
    throw error;
  }

  const running = dev;
  return {
    url,
    ingestToken,
    queryToken,
    async execute(sql) {
      const result = await run(wrangler, ['d1', 'execute', 'DB', '--local', '--persist-to', state, '--command', sql], root);
      if (result.code !== 0) {
        throw new Error(`The SQL failed:\n${result.output}`);
      }
    },
    async stop() {
      stopChild(running);
      await running.exit;
      await rm(state, { recursive: true, force: true });
    },
  };
}
