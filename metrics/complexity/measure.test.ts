import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listFiles, measure, parseScore } from './measure.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const OPTIONS = { include: ['src/**/*.{ts,tsx,js,jsx}'], exclude: [], testPatterns: ['**/*.test.*'] };
const roots: string[] = [];

async function makeRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-complexity-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('parseScore', () => {
  it('reads the cost from the JSON cyclomatic message', () => {
    // Arrange
    const message = JSON.stringify({ message: 'Function has a complexity of 18 which is greater than 0 authorized.', cost: 18, secondaryLocations: [] });

    // Act
    const result = parseScore('@sonarjs/cyclomatic-complexity', message);

    // Assert
    expect(result).toBe(18);
  });

  it('reads the score from the cognitive message text', () => {
    // Arrange
    const message = 'Refactor this function to reduce its Cognitive Complexity from 46 to the 0 allowed.';

    // Act
    const result = parseScore('@sonarjs/cognitive-complexity', message);

    // Assert
    expect(result).toBe(46);
  });

  it('returns null for a message it cannot read', () => {
    // Arrange
    const message = 'Function has a complexity of 3.';

    // Act
    const result = parseScore('@sonarjs/cyclomatic-complexity', message);

    // Assert
    expect(result).toBeNull();
  });
});

describe('listFiles', () => {
  it('lists the files that an include glob matches, sorted, with / separators', async () => {
    // Arrange
    const root = await makeRoot({ 'src/b.ts': '', 'src/a/c.tsx': '', 'src/d.md': '', 'lib/e.ts': '' });

    // Act
    const result = await listFiles(root, { include: ['src/**/*.{ts,tsx}'], exclude: [] });

    // Assert
    expect(result).toEqual(['src/a/c.tsx', 'src/b.ts']);
  });

  it('skips the files that an exclude glob matches', async () => {
    // Arrange
    const root = await makeRoot({ 'src/a.ts': '', 'src/gen/b.ts': '', 'src/c.d.ts': '' });

    // Act
    const result = await listFiles(root, { include: ['src/**/*.ts'], exclude: ['src/gen/**', '**/*.d.ts'] });

    // Assert
    expect(result).toEqual(['src/a.ts']);
  });

  it('never lists a file in node_modules', async () => {
    // Arrange
    const root = await makeRoot({ 'a.ts': '', 'node_modules/pkg/b.ts': '', 'packages/x/node_modules/pkg/c.ts': '', 'packages/x/d.ts': '' });

    // Act
    const result = await listFiles(root, { include: ['**/*.ts'], exclude: [] });

    // Assert
    expect(result).toEqual(['a.ts', 'packages/x/d.ts']);
  });

  it('lists a file once when two globs match it', async () => {
    // Arrange
    const root = await makeRoot({ 'src/a.ts': '' });

    // Act
    const result = await listFiles(root, { include: ['src/*.ts', 'src/**/*.ts'], exclude: [] });

    // Assert
    expect(result).toEqual(['src/a.ts']);
  });
});

describe('measure', () => {
  it('scores each function of the fixture sources, in plain and JSX files', async () => {
    // Act
    const { records, warnings } = await measure(FIXTURES, OPTIONS);

    // Assert
    expect(warnings).toEqual([]);
    expect(records.map((r) => `${r.file}:${r.qualified_name}`)).toEqual([
      'src/app.js:classify',
      'src/app.js:double',
      'src/app.test.js:checks',
      'src/app.test.js:checks > map',
      'src/ui/view.jsx:View',
      'src/ui/view.jsx:View > map',
      'src/ui/view.jsx:View > map > onClick',
    ]);
    const classify = records.find((r) => r.qualified_name === 'classify');
    expect(classify).toMatchObject({ line: 1, cyclomatic: 11, cognitive: 13, is_test: false });
  });

  it('marks the functions of the files that a test pattern matches', async () => {
    // Act
    const { records } = await measure(FIXTURES, OPTIONS);

    // Assert
    expect(records.filter((r) => r.is_test).map((r) => r.file)).toEqual(['src/app.test.js', 'src/app.test.js']);
  });

  it('measures a function that a disable comment tries to hide', async () => {
    // Arrange
    const root = await makeRoot({
      'src/a.ts': '// eslint-disable-next-line @sonarjs/cyclomatic-complexity\nexport function a(x: number) { return x > 1 ? 1 : 2; }\n',
    });

    // Act
    const { records, warnings } = await measure(root, OPTIONS);

    // Assert
    expect(warnings).toEqual([]);
    expect(records).toMatchObject([{ qualified_name: 'a', cyclomatic: 2 }]);
  });

  it('fails with the file and the line of a syntax error', async () => {
    // Arrange
    const root = await makeRoot({ 'src/a.ts': 'export function (\n' });

    // Act
    const result = measure(root, OPTIONS);

    // Assert
    await expect(result).rejects.toThrow(/^src\/a\.ts:\d+:/);
  });

  it('returns no function when no file matches', async () => {
    // Arrange
    const root = await makeRoot({ 'docs/a.md': '' });

    // Act
    const result = await measure(root, OPTIONS);

    // Assert
    expect(result).toEqual({ records: [], warnings: [] });
  });
});
