import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openCache } from './cache.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-cache-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('openCache', () => {
  test('returns undefined for a snapshot that is not cached, and returns a snapshot that is', async () => {
    const cache = await openCache(dir, 'coverage', 'https://w.example');

    expect(await cache.read('abc')).toBeUndefined();
    await cache.write('abc', { sha: 'abc' });

    expect(await cache.read('abc')).toEqual({ sha: 'abc' });
    expect(JSON.parse(await readFile(path.join(dir, 'coverage', 'abc.json'), 'utf8'))).toEqual({ sha: 'abc' });
  });

  test('records the uploaded keys in state.json, and a new cache reads them', async () => {
    const first = await openCache(dir, 'coverage', 'https://w.example');
    await first.markUploaded('a');
    await first.markUploaded('b');

    const second = await openCache(dir, 'coverage', 'https://w.example');

    expect([second.isUploaded('a'), second.isUploaded('b'), second.isUploaded('c')]).toEqual([true, true, false]);
    expect(JSON.parse(await readFile(path.join(dir, 'coverage', 'state.json'), 'utf8'))).toEqual({ workerUrl: 'https://w.example', uploaded: ['a', 'b'] });
  });

  test('keeps the state of each metric apart', async () => {
    await (await openCache(dir, 'coverage', 'https://w.example')).markUploaded('a');

    expect((await openCache(dir, 'complexity', 'https://w.example')).isUploaded('a')).toBe(false);
  });

  test('refuses a state that belongs to another Worker', async () => {
    await (await openCache(dir, 'coverage', 'https://one.example')).markUploaded('a');

    await expect(openCache(dir, 'coverage', 'https://two.example')).rejects.toThrow('records uploads to https://one.example');
  });

  test('reads the state of any Worker for a dry run, and refuses to write it', async () => {
    await (await openCache(dir, 'coverage', 'https://one.example')).markUploaded('a');

    const dry = await openCache(dir, 'coverage', undefined);

    expect(dry.isUploaded('a')).toBe(true);
    await expect(dry.markUploaded('b')).rejects.toThrow('without a Worker URL');
  });

  test.each([
    ['a file that is not JSON', 'nope'],
    ['a state without the fields', '{}'],
  ])('refuses %s', async (_label, content) => {
    await openCache(dir, 'coverage', 'https://w.example');
    await writeFile(path.join(dir, 'coverage', 'state.json'), content);

    await expect(openCache(dir, 'coverage', 'https://w.example')).rejects.toThrow('state.json');
  });
});
