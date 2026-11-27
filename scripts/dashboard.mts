import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { combineDashboards } from './combine-dashboards.mts';
import type { Dashboard, Entry } from './combine-dashboards.mts';

const root = path.resolve(import.meta.dirname, '..');
const ORDER = ['complexity', 'coverage', 'ci', 'tests'];
const USAGE = 'Usage: npm run dashboard -- [--metrics <a,b,...>] [--out <file>]';

async function readEntries(wanted: string[] | undefined): Promise<Entry[]> {
  const folders = (await readdir(path.join(root, 'metrics'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const rank = (name: string): number => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length);
  folders.sort((a, b) => rank(a) - rank(b));
  const entries: Entry[] = [];
  for (const metric of wanted ?? folders) {
    const text = await readFile(path.join(root, 'metrics', metric, 'dashboard.json'), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && !wanted) {
        return undefined;
      }
      throw new Error(`metrics/${metric}/dashboard.json: ${error.message}`);
    });
    if (text !== undefined) {
      entries.push({ metric, dashboard: JSON.parse(text) as Dashboard });
    }
  }
  return entries;
}

try {
  const { values } = parseArgs({ options: { metrics: { type: 'string' }, out: { type: 'string' } } });
  const entries = await readEntries(values.metrics?.split(',').map((name) => name.trim()).filter(Boolean));
  const json = `${JSON.stringify(combineDashboards(entries), null, 2)}\n`;
  if (values.out) {
    await writeFile(values.out, json);
  } else {
    process.stdout.write(json);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
  process.exitCode = 1;
}
