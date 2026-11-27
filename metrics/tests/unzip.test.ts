import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listEntries, safeTarget, unzipInto } from './unzip.ts';
import { makeZip } from './zip-fixture.ts';

const directories: string[] = [];

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-zip-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('unzipInto', () => {
  it('writes deflated and stored files, in subfolders', async () => {
    // Arrange
    const directory = await makeDirectory();
    const zip = makeZip([{ name: 'unit.json', content: '{"a":1}' }, { name: 'nested/e2e.json', content: 'stored text', stored: true }]);

    // Act
    await unzipInto(zip, directory);

    // Assert
    expect(await readFile(path.join(directory, 'unit.json'), 'utf8')).toBe('{"a":1}');
    expect(await readFile(path.join(directory, 'nested', 'e2e.json'), 'utf8')).toBe('stored text');
  });

  it.each([
    ['a parent folder', '../escape.txt'],
    ['a deep parent folder', 'a/../../escape.txt'],
    ['an absolute path', '/tmp/escape.txt'],
  ])('refuses an entry that leaves the folder through %s', async (_label, name) => {
    // Arrange
    const directory = await makeDirectory();

    // Act
    const unzip = unzipInto(makeZip([{ name, content: 'x' }]), directory);

    // Assert
    await expect(unzip).rejects.toThrow('outside the folder');
  });

  it('refuses data that is not a ZIP file', async () => {
    // Act
    const unzip = unzipInto(Buffer.from('not a zip file at all, only text'), await makeDirectory());

    // Assert
    await expect(unzip).rejects.toThrow('not a ZIP file');
  });

  it('refuses an entry that claims a small size and inflates to more', async () => {
    // Arrange
    const zip = makeZip([{ name: 'bomb.txt', content: 'a'.repeat(10_000) }]);
    const [entry] = listEntries(zip);
    zip.writeUInt32LE(10, (entry?.offset ?? 0) + 22);
    const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(10, central + 24);

    // Act
    const unzip = unzipInto(zip, await makeDirectory());

    // Assert
    await expect(unzip).rejects.toThrow();
  });
});

describe('safeTarget', () => {
  it('keeps a path inside the folder and refuses the folder itself and a path outside it', () => {
    // Arrange
    const directory = path.join(path.sep, 'tmp', 'artifact');

    // Assert
    expect(safeTarget(directory, 'a/b.json')).toBe(path.join(directory, 'a', 'b.json'));
    expect(safeTarget(directory, '..')).toBeNull();
    expect(safeTarget(directory, '')).toBeNull();
    expect(safeTarget(directory, '../artifact-other/a.json')).toBeNull();
  });
});
