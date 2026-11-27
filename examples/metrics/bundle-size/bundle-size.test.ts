import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../core/contract.ts';
import snapshot from './fixtures/snapshot.json' with { type: 'json' };
import { collector } from './collect.ts';
import { metric } from './metric.ts';
import { store } from './store.ts';

describe('bundlesize metric', () => {
  it('accepts the fixture snapshot', () => {
    expect(metric.parse(snapshot).files).toHaveLength(3);
  });

  it.each([
    ['a missing sha', { ...snapshot, sha: undefined }],
    ['a file with no size', { ...snapshot, files: [{ path: 'a.js', bytes: 1 }] }],
    ['a negative size', { ...snapshot, files: [{ path: 'a.js', bytes: -1, gzip_bytes: 0 }] }],
  ])('refuses %s', (_label, body) => {
    expect(() => metric.parse(body)).toThrow(ValidationError);
  });
});

describe('bundlesize store', () => {
  it('makes one row for each file, and every table is its own', () => {
    // Act
    const [part] = store.toRows(metric.parse(snapshot));

    // Assert
    expect(part?.rows).toEqual([['assets/app.css', 20, 40], ['assets/app.js', 350, 62], ['index.html', 34, 52]]);
    expect(store.tables.every((table) => table.startsWith('bundlesize_'))).toBe(true);
  });
});

describe('bundlesize collector', () => {
  it('measures the files of the build folder', async () => {
    // Act
    const result = await collector.collect({ inputs: { dir: 'dist' }, cwd: path.resolve(import.meta.dirname, 'fixtures'), env: {} });

    // Assert
    expect(result.files.map((file) => [file.path, file.bytes])).toEqual([['assets/app.css', 20], ['assets/app.js', 350], ['index.html', 34]]);
    expect(result.files.every((file) => file.gzip_bytes > 0)).toBe(true);
  });
});
