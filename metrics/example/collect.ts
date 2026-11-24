import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Collector } from '../../core/contract.ts';
import { metric } from './metric.ts';
import type { ExampleSnapshot } from './metric.ts';

export const collector: Collector<ExampleSnapshot> = {
  inputs: [{ name: 'file', description: 'JSON file with the sha, the date and the items.', default: 'example.json' }],
  backfill: 'commits',
  async collect(ctx) {
    const text = await readFile(path.resolve(ctx.cwd, ctx.inputs['file'] ?? 'example.json'), 'utf8');
    return metric.parse(JSON.parse(text));
  },
};
