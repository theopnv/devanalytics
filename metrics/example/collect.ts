import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Collector } from '../../core/contract.ts';
import { headCommit } from '../../core/git.ts';
import { metric } from './metric.ts';
import type { ExampleSnapshot } from './metric.ts';

export const collector: Collector<ExampleSnapshot> = {
  inputs: [{ name: 'file', description: 'JSON file with the items, and optionally the sha and the date.', default: 'example.json' }],
  backfill: 'commits',
  async collect(ctx) {
    const text = await readFile(path.resolve(ctx.cwd, ctx.inputs['file'] ?? 'example.json'), 'utf8');
    const body = JSON.parse(text) as Record<string, unknown>;
    const commit = 'sha' in body && 'date' in body ? {} : headCommit(ctx.cwd);
    return metric.parse({ ...commit, ...body });
  },
};
