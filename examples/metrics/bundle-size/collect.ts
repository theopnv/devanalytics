import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Collector } from '../../core/contract.ts';
import { headCommit } from '../../core/git.ts';
import { metric } from './metric.ts';
import type { BundleFile, BundleSizeSnapshot } from './metric.ts';

async function listFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)).sort();
}

export const collector: Collector<BundleSizeSnapshot> = {
  inputs: [{ name: 'dir', description: 'The folder that holds the build output, relative to working-directory.', default: 'dist' }],
  backfill: 'commits',
  async collect(ctx) {
    const root = path.resolve(ctx.cwd, ctx.inputs['dir'] ?? 'dist');
    const files: BundleFile[] = [];
    for (const file of await listFiles(root)) {
      const content = await readFile(file);
      files.push({ path: path.relative(root, file).split(path.sep).join('/'), bytes: content.length, gzip_bytes: gzipSync(content).length });
    }
    return metric.parse({ ...headCommit(ctx.cwd), files });
  },
};
