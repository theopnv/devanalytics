import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { combineDashboards } from './combine-dashboards.mts';
import type { Dashboard, Entry } from './combine-dashboards.mts';

const METRICS = ['complexity', 'coverage', 'ci', 'tests'];

async function load(metric: string): Promise<Entry> {
  const file = path.join(import.meta.dirname, '..', 'metrics', metric, 'dashboard.json');
  return { metric, dashboard: JSON.parse(await readFile(file, 'utf8')) as Dashboard };
}

const all = await Promise.all(METRICS.map(load));
const combined = combineDashboards(all);
const text = JSON.stringify(combined);

describe('combineDashboards', () => {
  it('gives each panel its own id', () => {
    const ids = combined.panels.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every panel of every dashboard, and adds only rows', () => {
    const panels = combined.panels.filter(({ type }) => type !== 'row').map(({ title }) => title);
    const expected = all.flatMap(({ dashboard }) => dashboard.panels.filter(({ type }) => type !== 'row').map(({ title }) => title));
    expect(panels).toEqual(expected);
  });

  it('puts one row before the panels of a metric, and keeps the rows that a dashboard has', () => {
    const rows = combined.panels.filter(({ type }) => type === 'row').map(({ title }) => title);
    expect(rows).toEqual(['Complexity', 'Coverage', 'Coverage: Tests', 'CI', 'Tests']);
  });

  it('places no panel on top of another', () => {
    const boxes = combined.panels.map(({ gridPos: { x, y, w, h } }) => ({ x, y, w, h }));
    const overlap = boxes.flatMap((a, index) => boxes.slice(index + 1).filter((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
    expect(overlap).toEqual([]);
  });

  it('gives each metric its own copy of a variable that two dashboards share', () => {
    const names = combined.templating.list.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining(['complexity_folder', 'coverage_folder', 'suite', 'workflow', 'group']));
    expect(names).not.toContain('folder');
    expect(combined.templating.list.find(({ name }) => name === 'coverage_folder')?.label).toBe('Coverage folder');
  });

  it('points every panel at a variable that the dashboard defines', () => {
    const defined = combined.templating.list.map(({ name }) => name);
    const used = [...text.matchAll(/\$([a-z_]+)\\?"/g)].map((match) => match[1] ?? '');
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) {
      expect(defined).toContain(name);
    }
  });

  it('lists each input once, and every input is used', () => {
    const names = combined.__inputs.map(({ name }) => name);
    const used = [...new Set([...text.matchAll(/\$\{([A-Z][A-Z_]*)\}/g)].map((match) => match[1]))];
    expect(names.sort()).toEqual(used.sort());
    expect(names).toHaveLength(3);
  });

  it('keeps the variable names when there is nothing to share', async () => {
    // Act
    const single = combineDashboards([await load('coverage')]);

    // Assert
    expect(single.templating.list.map(({ name }) => name)).toEqual(['folder', 'suite']);
    expect(JSON.stringify(single)).toContain('$folder');
  });

  it('refuses an empty list', () => {
    expect(() => combineDashboards([])).toThrow('at least one');
  });
});
