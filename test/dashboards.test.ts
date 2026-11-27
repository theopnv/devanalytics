/// <reference types="vite/client" />
import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

const INGEST = 'test-ingest-token';
const QUERY = 'test-query-token';

interface Column {
  selector: string;
  type: string;
}

interface Target {
  refId: string;
  url: string;
  url_options: { data: string };
  root_selector: string;
  columns: Column[];
}

interface Panel {
  id: number;
  type: string;
  title: string;
  targets?: Target[];
}

interface Variable {
  name: string;
  query: { infinityQuery: Target };
}

interface Dashboard {
  __inputs: { name: string; type: string }[];
  panels: Panel[];
  templating: { list: Variable[] };
}

interface QueryBody {
  sql: string;
  params?: unknown[];
}

const dashboards = import.meta.glob<Dashboard>('../metrics/*/dashboard.json', { eager: true, import: 'default' });
const snapshots = import.meta.glob<unknown>('../metrics/*/fixtures/snapshot.json', { eager: true, import: 'default' });

const metricOf = (file: string): string => /metrics\/([^/]+)\//.exec(file)?.[1] ?? '';

function send(path: string, token: string, body: unknown): Promise<Response> {
  return exports.default.fetch(new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
}

/** Grafana replaces `$name` in the request body before it sends the query. */
function interpolate(data: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`$${name}`, value), data);
}

async function run(metric: string, target: Target, values: Record<string, string>) {
  const response = await send(`/v1/${metric}/query`, QUERY, JSON.parse(interpolate(target.url_options.data, values)) as QueryBody);
  const body = await response.json<{ rows?: Record<string, unknown>[]; error?: string }>();
  return { status: response.status, rows: body.rows ?? [], error: body.error };
}

function checkColumns(target: Target, rows: Record<string, unknown>[]): void {
  const [first] = rows;
  if (!first) {
    return;
  }
  for (const { selector, type } of target.columns) {
    expect(first, `column ${selector}`).toHaveProperty(selector);
    for (const row of rows) {
      const value = row[selector];
      if (type === 'timestamp') {
        expect(Number.isNaN(Date.parse(String(value))), `${selector} = ${String(value)}`).toBe(false);
      } else if (type === 'number') {
        expect(value === null || typeof value === 'number', `${selector} = ${String(value)}`).toBe(true);
      }
    }
  }
}

function combinations(options: Record<string, string[]>): Record<string, string>[] {
  return Object.entries(options).reduce<Record<string, string>[]>(
    (combos, [name, choices]) => combos.flatMap((combo) => choices.map((choice) => ({ ...combo, [name]: choice }))),
    [{}],
  );
}

describe.each(Object.entries(dashboards))('dashboard %s', (file, dashboard) => {
  const metric = metricOf(file);
  const variables = dashboard.templating.list;
  const panels = dashboard.panels.filter((panel) => panel.targets);
  const options: Record<string, string[]> = {};
  const text = JSON.stringify(dashboard);

  beforeAll(async () => {
    const snapshot = snapshots[`../metrics/${metric}/fixtures/snapshot.json`];
    expect(snapshot, 'the metric needs fixtures/snapshot.json').toBeDefined();
    expect((await send(`/v1/${metric}/ingest`, INGEST, snapshot)).status).toBe(200);
    for (const variable of variables) {
      const { rows } = await run(metric, variable.query.infinityQuery, {});
      options[variable.name] = rows.map((row) => String(Object.values(row)[0]));
    }
  });

  it('declares every input that it uses, and uses every input that it declares', () => {
    const used = new Set([...text.matchAll(/\$\{([A-Z][A-Z_]*)\}/g)].map((match) => match[1]));
    expect([...used].sort()).toEqual(dashboard.__inputs.map(({ name }) => name).sort());
  });

  it('has no value of one project in it', () => {
    expect(text).not.toMatch(/monfil|theopnv|workers\.dev\/v1/i);
    expect(text).not.toContain("'src'");
  });

  it('gives each panel its own id', () => {
    const ids = dashboard.panels.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only a template variable that it defines', () => {
    const defined = variables.map(({ name }) => name);
    const used = [...text.matchAll(/\$([a-z_]+)\\?"/g)].map((match) => match[1] ?? '');
    for (const name of used) {
      expect(defined).toContain(name);
    }
  });

  it.each(variables.map((variable) => [variable.name, variable.query.infinityQuery] as const))('runs the query of the variable %s', async (name, target) => {
    // Act
    const { status, rows, error } = await run(metric, target, {});

    // Assert
    expect(error).toBeUndefined();
    expect(status).toBe(200);
    expect(rows.length).toBeGreaterThan(0);
    expect(options[name]?.length).toBeGreaterThan(0);
    checkColumns(target, rows);
  });

  describe.each(panels.flatMap((panel) => (panel.targets ?? []).map((target) => [`${panel.title} (${target.refId})`, target] as const)))('panel %s', (_title, target) => {
    it('queries the route of its metric', () => {
      expect(target.url).toBe(`\${WORKER_URL}/v1/${metric}/query`);
      expect(target.root_selector).toBe('rows');
    });

    it('runs for every value of the variables, and finds rows for at least one', async () => {
      // Act
      const results = await Promise.all(combinations(options).map((values) => run(metric, target, values)));

      // Assert
      for (const { status, rows, error } of results) {
        expect(error).toBeUndefined();
        expect(status).toBe(200);
        checkColumns(target, rows);
      }
      expect(results.some(({ rows }) => rows.length > 0)).toBe(true);
    });

    it('runs on a public dashboard, which does not replace the variables, with the first value of each variable', async () => {
      // Arrange
      const first = Object.fromEntries(Object.entries(options).map(([name, choices]) => [name, choices[0] ?? '']));

      // Act
      const named = await run(metric, target, first);
      const raw = await run(metric, target, {});

      // Assert
      expect(raw.error).toBeUndefined();
      expect(raw.status).toBe(200);
      expect(raw.rows).toEqual(named.rows);
    });
  });
});
