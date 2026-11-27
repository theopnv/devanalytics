import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSuites, loadTestCounts, parseNamedPaths } from './reports.ts';

const roots: string[] = [];

async function makeRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-coverage-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}

const lcov = (file: string, ...lines: [number, number][]) => `SF:${file}\n${lines.map(([line, hits]) => `DA:${line},${hits}`).join('\n')}\nend_of_record\n`;

function istanbul(file: string, hits: number[]): string {
  return JSON.stringify({
    [file]: {
      path: file,
      statementMap: Object.fromEntries(hits.map((_, i) => [String(i), { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 5 } }])),
      s: Object.fromEntries(hits.map((hit, i) => [String(i), hit])),
      fnMap: {},
      f: {},
      branchMap: {},
      b: {},
    },
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('parseNamedPaths', () => {
  it('reads one suite=path pair on each line', () => {
    // Act
    const result = parseNamedPaths('reports', ' unit = coverage/unit/lcov.info \n\ne2e=coverage/e2e.json\n');

    // Assert
    expect(result).toEqual([{ name: 'unit', file: 'coverage/unit/lcov.info' }, { name: 'e2e', file: 'coverage/e2e.json' }]);
  });

  it('keeps an equals sign inside the path', () => {
    // Act
    const result = parseNamedPaths('reports', 'unit=out/a=b.info');

    // Assert
    expect(result).toEqual([{ name: 'unit', file: 'out/a=b.info' }]);
  });

  it('gives no pair for a missing value', () => {
    // Act
    const result = parseNamedPaths('test-results', undefined);

    // Assert
    expect(result).toEqual([]);
  });

  it.each([
    ['a line without a name', 'coverage/lcov.info', /must look like suite=path/],
    ['a line without a path', 'unit=', /must look like suite=path/],
    ['a bad suite name', 'my suite=a.info', /is not a suite name/],
    ['a name that two lines use', 'unit=a.info\nunit=b.info', /named twice/],
  ])('refuses %s', (_label, value, message) => {
    // Act
    const parse = () => parseNamedPaths('reports', value);

    // Assert
    expect(parse).toThrow(message);
  });
});

describe('loadSuites', () => {
  it('stores one report as the total suite only', async () => {
    // Arrange
    const root = await makeRoot({ 'lcov.info': lcov('src/a.ts', [1, 1], [2, 0]) });

    // Act
    const suites = await loadSuites(root, [{ name: 'unit', file: 'lcov.info' }]);

    // Assert
    expect(Object.keys(suites)).toEqual(['total']);
    expect(suites['total']?.[0]?.lines).toEqual([1, 2]);
  });

  it('adds a total suite that is the union of two lcov reports', async () => {
    // Arrange
    const root = await makeRoot({
      'unit.info': lcov('src/a.ts', [1, 1], [2, 0]),
      'e2e.info': lcov('src/a.ts', [2, 3], [3, 0]) + lcov('src/b.ts', [1, 1]),
    });

    // Act
    const suites = await loadSuites(root, [{ name: 'unit', file: 'unit.info' }, { name: 'e2e', file: 'e2e.info' }]);

    // Assert
    expect(Object.keys(suites).sort()).toEqual(['e2e', 'total', 'unit']);
    expect(suites['unit']?.map(({ file, lines }) => [file, lines])).toEqual([['src/a.ts', [1, 2]]]);
    expect(suites['total']?.map(({ file, lines }) => [file, lines])).toEqual([['src/a.ts', [2, 3]], ['src/b.ts', [1, 1]]]);
  });

  it('adds a total suite that is the union of two Istanbul reports', async () => {
    // Arrange
    const root = await makeRoot({ 'unit.json': istanbul('src/a.ts', [1, 0]), 'e2e.json': istanbul('src/a.ts', [0, 2]) });

    // Act
    const suites = await loadSuites(root, [{ name: 'unit', file: 'unit.json' }, { name: 'e2e', file: 'e2e.json' }]);

    // Assert
    expect(suites['unit']?.[0]?.lines).toEqual([1, 2]);
    expect(suites['total']?.[0]?.lines).toEqual([2, 2]);
  });

  it('refuses a total suite from reports in two formats', async () => {
    // Arrange
    const root = await makeRoot({ 'unit.info': lcov('src/a.ts', [1, 1]), 'e2e.json': istanbul('src/a.ts', [1]) });

    // Act
    const load = loadSuites(root, [{ name: 'unit', file: 'unit.info' }, { name: 'e2e', file: 'e2e.json' }]);

    // Assert
    await expect(load).rejects.toThrow('cannot merge Istanbul JSON and lcov reports');
  });

  it('refuses a report that the user names total, next to another report', async () => {
    // Arrange
    const root = await makeRoot({ 'a.info': lcov('src/a.ts', [1, 1]), 'b.info': lcov('src/a.ts', [1, 1]) });

    // Act
    const load = loadSuites(root, [{ name: 'total', file: 'a.info' }, { name: 'unit', file: 'b.info' }]);

    // Assert
    await expect(load).rejects.toThrow('"total" is the name of the union');
  });

  it('names the suite and the file when a report is missing', async () => {
    // Arrange
    const root = await makeRoot({});

    // Act
    const load = loadSuites(root, [{ name: 'unit', file: 'coverage/lcov.info' }]);

    // Assert
    await expect(load).rejects.toThrow(/reports: cannot read coverage\/lcov\.info for the suite "unit"/);
  });

  it('names the suite and the file when a JSON report is not valid', async () => {
    // Arrange
    const root = await makeRoot({ 'bad.json': '{ nope' });

    // Act
    const load = loadSuites(root, [{ name: 'unit', file: 'bad.json' }]);

    // Assert
    await expect(load).rejects.toThrow(/reports: cannot read bad\.json for the suite "unit"/);
  });

  it('refuses an empty list', async () => {
    // Act
    const load = loadSuites(os.tmpdir(), []);

    // Assert
    await expect(load).rejects.toThrow('give at least one report');
  });
});

describe('loadTestCounts', () => {
  it('reads the test counts of each suite', async () => {
    // Arrange
    const root = await makeRoot({
      'unit.json': JSON.stringify({ testResults: [{ assertionResults: [{ status: 'passed' }] }] }),
      'e2e.xml': '<testsuite><testcase name="a" classname="c"><failure/></testcase></testsuite>',
    });

    // Act
    const counts = await loadTestCounts(root, [{ name: 'unit', file: 'unit.json' }, { name: 'e2e', file: 'e2e.xml' }]);

    // Assert
    expect(counts).toEqual({
      unit: { files: 1, tests: 1, passed: 1, failed: 0, skipped: 0 },
      e2e: { files: 1, tests: 1, passed: 0, failed: 1, skipped: 0 },
    });
  });

  it('names the suite and the file when a report is not a test report', async () => {
    // Arrange
    const root = await makeRoot({ 'bad.json': '{"a":1}' });

    // Act
    const load = loadTestCounts(root, [{ name: 'unit', file: 'bad.json' }]);

    // Assert
    await expect(load).rejects.toThrow(/test-results: cannot read bad\.json for the suite "unit": bad\.json is not a Vitest JSON/);
  });
});
