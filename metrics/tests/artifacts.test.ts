import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadArtifacts, folderName } from './artifacts.ts';
import { makeZip } from './zip-fixture.ts';

const directories: string[] = [];
const ENV = { GITHUB_REPOSITORY: 'octo/repo' };

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-artifacts-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('folderName', () => {
  it.each(['ubuntu-latest', 'macos-14', 'windows latest', 'node_22.x'])('accepts %s', (name) => {
    expect(folderName(name)).toBe(name);
  });

  it.each(['..', '.hidden', 'a/b', 'a\\b', '../x', 'a..b', ''])('refuses "%s"', (name) => {
    expect(folderName(name)).toBeNull();
  });
});

describe('downloadArtifacts', () => {
  it('writes one folder for each artifact, with the token sent to GitHub', async () => {
    // Arrange
    const send = vi.fn(async (url: string) => {
      if (url.includes('/runs/9/artifacts')) {
        return Response.json({ artifacts: [{ id: 1, name: 'ubuntu-latest', expired: false }, { id: 2, name: 'macos-latest', expired: false }] });
      }
      return new Response(makeZip([{ name: 'unit.json', content: url.includes('/artifacts/1/') ? 'ubuntu' : 'macos' }]));
    });
    vi.stubGlobal('fetch', send);
    const directory = await makeDirectory();
    const warnings: string[] = [];

    // Act
    const written = await downloadArtifacts(ENV, 'secret', 9, directory, (message) => warnings.push(message));

    // Assert
    expect(written).toBe(2);
    expect(await readFile(path.join(directory, 'ubuntu-latest', 'unit.json'), 'utf8')).toBe('ubuntu');
    expect(await readFile(path.join(directory, 'macos-latest', 'unit.json'), 'utf8')).toBe('macos');
    expect(send).toHaveBeenCalledWith('https://api.github.com/repos/octo/repo/actions/artifacts/1/zip', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) }));
    expect(warnings).toEqual([]);
  });

  it('skips an expired artifact and an artifact with an unsafe name, with a warning', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ artifacts: [{ id: 1, name: 'old', expired: true }, { id: 2, name: '../escape', expired: false }] })));
    const warnings: string[] = [];

    // Act
    const written = await downloadArtifacts(ENV, 'secret', 9, await makeDirectory(), (message) => warnings.push(message));

    // Assert
    expect(written).toBe(0);
    expect(warnings).toEqual(['Skipped the artifact "old": it expired.', 'Skipped the artifact "../escape": its name cannot be a folder name.']);
  });

  it('warns and goes on when one download fails', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/artifacts?')
      ? Response.json({ artifacts: [{ id: 1, name: 'gone', expired: false }] })
      : new Response('gone', { status: 410 }))));
    const warnings: string[] = [];

    // Act
    const written = await downloadArtifacts(ENV, 'secret', 9, await makeDirectory(), (message) => warnings.push(message));

    // Assert
    expect(written).toBe(0);
    expect(warnings).toEqual(['Skipped the artifact "gone": GitHub answered 410.']);
  });

  it('fails when GitHub refuses the list', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })));

    // Act
    const download = downloadArtifacts(ENV, 'secret', 9, await makeDirectory(), () => undefined);

    // Assert
    await expect(download).rejects.toThrow('GitHub answered 403');
  });

  it('needs the repository', async () => {
    // Act
    const download = downloadArtifacts({}, 'secret', 9, await makeDirectory(), () => undefined);

    // Assert
    await expect(download).rejects.toThrow('GITHUB_REPOSITORY');
  });
});
