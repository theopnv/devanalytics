import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { sync } from './sync.mts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const WORKER_REGISTRY = 'src/generated/worker-registry.ts';
const COLLECTOR_REGISTRY = 'action/src/generated/collector-registry.ts';

let root: string;

const read = (file: string): Promise<string> => readFile(path.join(root, file), 'utf8');
const list = (folder: string): Promise<string[]> => readdir(path.join(root, folder)).then((names) => names.sort());

async function addMetric(name: string, files: string[] = ['metric.ts', 'store.ts', 'collect.ts']): Promise<void> {
  const folder = path.join(root, 'metrics', name);
  await mkdir(path.join(folder, 'migrations'), { recursive: true });
  for (const file of files) {
    await writeFile(path.join(folder, file), '');
  }
  await writeFile(path.join(folder, 'migrations', '0001_init.sql'), `CREATE TABLE ${name}_rows (sha TEXT);`);
  await writeFile(path.join(folder, 'migrations', '0002_more.sql'), `CREATE INDEX ${name}_rows_sha ON ${name}_rows (sha);`);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-sync-'));
  await mkdir(path.join(root, 'core', 'migrations'), { recursive: true });
  await writeFile(path.join(root, 'core', 'migrations', '0001_usage.sql'), 'CREATE TABLE usage (day TEXT);');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('sync', () => {
  test('generates empty registries and only the core migrations when there is no metric', async () => {
    expect(await sync(root)).toEqual([]);

    expect(await read(WORKER_REGISTRY)).toContain('workerRegistry: readonly WorkerEntry[] = [\n];');
    expect(await read(COLLECTOR_REGISTRY)).toContain('collectorRegistry: readonly CollectorEntry[] = [\n];');
    expect(await list('migrations')).toEqual(['0001_usage.sql']);
  });

  test('adds a metric to the registries and prefixes its migrations', async () => {
    await cp(path.join(repoRoot, 'metrics', 'example'), path.join(root, 'metrics', 'example'), { recursive: true });

    expect(await sync(root)).toEqual(['example']);

    const worker = await read(WORKER_REGISTRY);
    expect(worker).toContain("import { metric as exampleMetric } from '../../metrics/example/metric.ts';");
    expect(worker).toContain("import { store as exampleStore } from '../../metrics/example/store.ts';");
    expect(worker).toContain('{ metric: exampleMetric, store: exampleStore },');
    const collectors = await read(COLLECTOR_REGISTRY);
    expect(collectors).toContain("import { collector as exampleCollector } from '../../../metrics/example/collect.ts';");
    expect(collectors).toContain('{ metric: exampleMetric, collector: exampleCollector },');
    expect(await list('migrations')).toEqual(['0001_usage.sql', 'example__0001_init.sql']);
    expect(await read('migrations/example__0001_init.sql')).toBe(await readFile(path.join(repoRoot, 'metrics/example/migrations/0001_init.sql'), 'utf8'));
  });

  test('removes a metric from the registries and from migrations/ after its folder is deleted', async () => {
    await addMetric('example');
    await sync(root);
    await rm(path.join(root, 'metrics', 'example'), { recursive: true });

    expect(await sync(root)).toEqual([]);

    expect(await read(WORKER_REGISTRY)).not.toContain('example');
    expect(await read(COLLECTOR_REGISTRY)).not.toContain('example');
    expect(await list('migrations')).toEqual(['0001_usage.sql']);
  });

  test('orders metrics by name and keeps the migrations of each metric in file order', async () => {
    await addMetric('tests');
    await addMetric('coverage');

    await sync(root);

    const worker = await read(WORKER_REGISTRY);
    expect(worker.indexOf('coverageMetric')).toBeLessThan(worker.indexOf('testsMetric'));
    expect(await list('migrations')).toEqual([
      '0001_usage.sql',
      'coverage__0001_init.sql',
      'coverage__0002_more.sql',
      'tests__0001_init.sql',
      'tests__0002_more.sql',
    ]);
  });

  test('gives the same output when it runs twice', async () => {
    await addMetric('coverage');
    await sync(root);
    const first = [await read(WORKER_REGISTRY), await read(COLLECTOR_REGISTRY), await list('migrations')];

    await sync(root);

    expect([await read(WORKER_REGISTRY), await read(COLLECTOR_REGISTRY), await list('migrations')]).toEqual(first);
  });

  test('refuses a metric folder that lacks a contract file', async () => {
    await addMetric('broken', ['metric.ts']);

    await expect(sync(root)).rejects.toThrow('metrics/broken: missing store.ts, collect.ts.');
  });

  test('refuses a metric name that cannot prefix a table', async () => {
    await addMetric('bundle-size');

    await expect(sync(root)).rejects.toThrow('lowercase letters and digits only');
  });
});
