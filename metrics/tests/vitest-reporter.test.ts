import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DevanalyticsReporter, { toReport } from '../../action/reporters/vitest.mjs';
import type { TestCaseLike, TestModuleLike } from '../../action/reporters/vitest.mjs';
import { summarizeVitestReporter } from './report.ts';

function testCase(overrides: Partial<TestCaseLike> & { state?: string; retryCount?: number; errors?: string[] } = {}): TestCaseLike {
  const { state = 'passed', retryCount = 0, errors = [] } = overrides;
  return {
    fullName: 'suite > test',
    module: { moduleId: path.resolve('src/a.test.ts') },
    result: () => ({ state, errors: errors.map((message) => ({ message })) }),
    diagnostic: () => ({ retryCount }),
    attempts: () => [],
    ...overrides,
  };
}

const moduleOf = (...tests: TestCaseLike[]): TestModuleLike => ({ children: { allTests: () => tests } });

describe('toReport', () => {
  it('reads the file, the full name, the state and the retries of each test', () => {
    // Arrange
    const modules = [moduleOf(testCase({ retryCount: 1 }), testCase({ state: 'pending' }))];

    // Act
    const report = toReport(modules, process.cwd());

    // Assert
    expect(report.tests).toEqual([
      { file: 'src/a.test.ts', title: 'suite > test', state: 'passed', retries: 1, error: '' },
      { file: 'src/a.test.ts', title: 'suite > test', state: 'skipped', retries: 0, error: '' },
    ]);
  });

  it('takes the message of a failed test from its final result', () => {
    // Arrange
    const modules = [moduleOf(testCase({ state: 'failed', errors: ['expected 1 to be 2'] }))];

    // Act
    const [test] = toReport(modules, process.cwd()).tests;

    // Assert
    expect(test).toMatchObject({ state: 'failed', error: 'expected 1 to be 2' });
  });

  it('takes the message of a flaky test from its first failed attempt', () => {
    // Arrange
    const flaky = testCase({
      retryCount: 1,
      attempts: () => [{ state: 'failed', errors: [{ message: 'timeout' }] }, { state: 'passed' }],
    });

    // Act
    const [test] = toReport([moduleOf(flaky)], process.cwd()).tests;

    // Assert
    expect(test).toMatchObject({ state: 'passed', retries: 1, error: 'timeout' });
  });

  it('counts no retries when Vitest has no diagnostic for the test', () => {
    // Act
    const [test] = toReport([moduleOf(testCase({ diagnostic: () => undefined }))], process.cwd()).tests;

    // Assert
    expect(test?.retries).toBe(0);
  });

  it('gives a report that the collector reads', () => {
    // Arrange
    const flaky = testCase({ retryCount: 1, attempts: () => [{ state: 'failed', errors: [{ message: 'timeout' }] }] });

    // Act
    const summary = summarizeVitestReporter(toReport([moduleOf(flaky, testCase())], process.cwd()));

    // Assert
    expect(summary).toMatchObject({ tests: 2, passed: 2, flaky: 1 });
  });
});

describe('DevanalyticsReporter', () => {
  let directory = '';

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('writes the report to the file named by DEVANALYTICS_VITEST_REPORT, with its folder', async () => {
    // Arrange
    directory = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-reporter-'));
    const file = path.join(directory, 'nested', 'unit.json');
    vi.stubEnv('DEVANALYTICS_VITEST_REPORT', file);

    // Act
    new DevanalyticsReporter().onTestRunEnd([moduleOf(testCase())]);

    // Assert
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      tests: [{ file: path.relative(process.cwd(), path.resolve('src/a.test.ts')).split(path.sep).join('/'), title: 'suite > test', state: 'passed', retries: 0, error: '' }],
    });
  });

  it('writes nothing when DEVANALYTICS_VITEST_REPORT is not set', () => {
    // Arrange
    vi.stubEnv('DEVANALYTICS_VITEST_REPORT', '');

    // Act
    const run = () => new DevanalyticsReporter().onTestRunEnd([moduleOf(testCase())]);

    // Assert
    expect(run).not.toThrow();
  });
});
