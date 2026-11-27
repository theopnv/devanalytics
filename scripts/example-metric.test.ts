import { cp, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Collector, Metric, Snapshot, Store } from '../core/contract.ts';
import { sync } from './sync.mts';

const repoRoot = path.resolve(import.meta.dirname, '..');
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-example-'));
  await symlink(path.join(repoRoot, 'core'), path.join(root, 'core'));
  await cp(path.join(repoRoot, 'examples', 'metrics', 'bundle-size'), path.join(root, 'metrics', 'bundlesize'), { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

// `docs/write-a-metric.md` tells the reader to copy the example to `metrics/bundlesize/`, so it must work from there.
describe('the bundle-size example, copied to metrics/bundlesize', () => {
  test('passes sync and keeps the folder name rule', async () => {
    expect(await sync(root)).toEqual(['bundlesize']);
    expect(await readdir(path.join(root, 'migrations'))).toContain('bundlesize__0001_init.sql');
  });

  test('collects its fixtures into rows of its own table', async () => {
    // Arrange
    const folder = path.join(root, 'metrics', 'bundlesize');
    const { metric } = await import(path.join(folder, 'metric.ts')) as { metric: Metric<Snapshot> };
    const { store } = await import(path.join(folder, 'store.ts')) as { store: Store<Snapshot> };
    const { collector } = await import(path.join(folder, 'collect.ts')) as { collector: Collector<Snapshot> };

    // Act
    const snapshot = await collector.collect({ inputs: { dir: 'dist' }, cwd: path.join(repoRoot, 'examples', 'metrics', 'bundle-size', 'fixtures'), env: {} });
    const parts = store.toRows(metric.parse(snapshot));

    // Assert
    expect(metric.name).toBe('bundlesize');
    expect(parts.map(({ table }) => table)).toEqual(['bundlesize_files']);
    expect(parts[0]?.rows).toHaveLength(3);
  });
});
