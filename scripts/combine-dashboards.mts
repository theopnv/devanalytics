export interface Dashboard {
  title: string;
  uid: string;
  description?: string;
  __inputs: { name: string }[];
  __requires: { type: string; id: string }[];
  panels: Panel[];
  templating: { list: Variable[] };
  [key: string]: unknown;
}

interface Panel {
  id: number;
  type: string;
  title: string;
  gridPos: { x: number; y: number; w: number; h: number };
  [key: string]: unknown;
}

interface Variable {
  name: string;
  label?: string;
  [key: string]: unknown;
}

export interface Entry {
  metric: string;
  dashboard: Dashboard;
}

const TITLE_PREFIX = 'Devanalytics: ';

const upper = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function sectionName({ metric, dashboard }: Entry): string {
  return dashboard.title.startsWith(TITLE_PREFIX) ? upper(dashboard.title.slice(TITLE_PREFIX.length)) : upper(metric);
}

/** A name that two dashboards define is a different variable in each, so each metric gets its own copy. */
function sharedNames(entries: readonly Entry[]): Set<string> {
  const counts = new Map<string, number>();
  for (const { dashboard } of entries) {
    for (const { name } of dashboard.templating.list) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

function renameIn(text: string, renames: ReadonlyMap<string, string>): string {
  let result = text;
  for (const [from, to] of renames) {
    result = result
      .replaceAll(new RegExp(String.raw`\$\{${from}\}`, 'g'), `\${${to}}`)
      .replaceAll(new RegExp(String.raw`\$${from}(?![A-Za-z0-9_])`, 'g'), `$${to}`)
      .replaceAll(new RegExp(String.raw`"name":"${from}"`, 'g'), `"name":"${to}"`);
  }
  return result;
}

interface Part {
  panels: Panel[];
  variables: Variable[];
}

function renamed(entry: Entry, shared: ReadonlySet<string>): Part {
  const renames = new Map(entry.dashboard.templating.list.filter(({ name }) => shared.has(name)).map(({ name }) => [name, `${entry.metric}_${name}`]));
  const part: Part = {
    panels: entry.dashboard.panels,
    variables: entry.dashboard.templating.list.map((variable) => (renames.has(variable.name) ? { ...variable, label: `${sectionName(entry)} ${(variable.label ?? variable.name).toLowerCase()}` } : variable)),
  };
  return JSON.parse(renameIn(JSON.stringify(part), renames)) as Part;
}

/** A dashboard with its own rows keeps them. A dashboard without a row gets one that names the metric. */
function sectionPanels(entry: Entry, panels: readonly Panel[], offset: number): { panels: Panel[]; height: number } {
  const name = sectionName(entry);
  const hasRows = panels.some(({ type }) => type === 'row');
  const header: Panel[] = hasRows ? [] : [{ id: 0, type: 'row', title: name, collapsed: false, panels: [], gridPos: { x: 0, y: offset, w: 24, h: 1 } }];
  const shift = hasRows ? offset : offset + 1;
  const moved = panels.map((panel) => ({
    ...panel,
    title: panel.type === 'row' && panel.title !== name ? `${name}: ${panel.title}` : panel.title,
    gridPos: { ...panel.gridPos, y: panel.gridPos.y + shift },
  }));
  const bottom = Math.max(...moved.map(({ gridPos }) => gridPos.y + gridPos.h));
  return { panels: [...header, ...moved], height: bottom - offset };
}

function unionBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

/** Puts the dashboards of several metrics on one page: one row for each metric, and the variables of all of them. */
export function combineDashboards(entries: readonly Entry[]): Dashboard {
  const [first] = entries;
  if (!first) {
    throw new Error('Give at least one dashboard.');
  }
  const shared = sharedNames(entries);
  let offset = 0;
  const panels: Panel[] = [];
  const variables: Variable[] = [];
  for (const entry of entries) {
    const part = renamed(entry, shared);
    const section = sectionPanels(entry, part.panels, offset);
    panels.push(...section.panels);
    variables.push(...part.variables);
    offset += section.height;
  }
  return {
    ...first.dashboard,
    title: 'Devanalytics',
    uid: 'devanalytics',
    description: `Devanalytics: ${entries.map(({ metric }) => metric).join(', ')}.`,
    __inputs: unionBy(entries.flatMap(({ dashboard }) => dashboard.__inputs), ({ name }) => name),
    __requires: unionBy(entries.flatMap(({ dashboard }) => dashboard.__requires), ({ type, id }) => `${type}:${id}`),
    panels: panels.map((panel, index) => ({ ...panel, id: index + 1 })),
    templating: { list: variables },
  };
}
