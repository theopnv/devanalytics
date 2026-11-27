import { describe, expect, it } from 'vitest';
import { clipError, summarizeJunit, summarizePlaywright, summarizeReport, summarizeVitestJson, summarizeVitestReporter } from './report.ts';

describe('summarizeVitestReporter', () => {
  it('counts each state and lists the failed and flaky tests', () => {
    // Arrange
    const report = {
      tests: [
        { file: 'src/a.test.ts', title: 'passes', state: 'passed', retries: 0, error: '' },
        { file: 'src/a.test.ts', title: 'flakes', state: 'passed', retries: 1, error: 'timeout\nstack line' },
        { file: 'src/b.test.ts', title: 'breaks', state: 'failed', retries: 1, error: 'expected 1 to be 2' },
        { file: 'src/b.test.ts', title: 'waits', state: 'skipped', retries: 0, error: '' },
      ],
    };

    // Act
    const result = summarizeVitestReporter(report);

    // Assert
    expect(result).toMatchObject({ tests: 4, passed: 2, failed: 1, skipped: 1, flaky: 1 });
    expect(result.exceptions).toEqual([
      { file: 'src/a.test.ts', title: 'flakes', status: 'flaky', retries: 1, error: 'timeout' },
      { file: 'src/b.test.ts', title: 'breaks', status: 'failed', retries: 1, error: 'expected 1 to be 2' },
    ]);
  });

  it('keeps a test that passed on the first try out of the exceptions', () => {
    // Act
    const result = summarizeVitestReporter({ tests: [{ file: 'a', title: 'b', state: 'passed', retries: 0, error: '' }] });

    // Assert
    expect(result.exceptions).toEqual([]);
  });

  it('treats a missing retry count as no retry and fills an empty message', () => {
    // Act
    const result = summarizeVitestReporter({ tests: [{ file: 'a.test.ts', title: 'b', state: 'failed' }] });

    // Assert
    expect(result.exceptions).toEqual([{ file: 'a.test.ts', title: 'b', status: 'failed', retries: 0, error: 'no message' }]);
  });

  it.each([
    ['a value that is not an object', 'nope'],
    ['a report without tests', {}],
    ['a test with an unknown state', { tests: [{ file: 'a', title: 'b', state: 'pending' }] }],
    ['a test that is not an object', { tests: [null] }],
  ])('refuses %s', (_label, value) => {
    // Act
    const summarize = () => summarizeVitestReporter(value);

    // Assert
    expect(summarize).toThrow();
  });
});

describe('summarizeVitestJson', () => {
  const report = {
    testResults: [
      {
        name: '/work/repo/src/a.test.ts',
        assertionResults: [
          { fullName: 'a passes', status: 'passed', failureMessages: [] },
          { fullName: 'a breaks', status: 'failed', failureMessages: ['AssertionError: expected 1 to be 2\n    at stack'] },
          { fullName: 'a waits', status: 'pending', failureMessages: [] },
          { title: 'todo', status: 'todo' },
        ],
      },
    ],
  };

  it('counts the states, and lists the failed tests with a path relative to the workspace', () => {
    // Act
    const result = summarizeVitestJson(report, '/work/repo');

    // Assert
    expect(result).toMatchObject({ tests: 4, passed: 1, failed: 1, skipped: 2, flaky: 0 });
    expect(result.exceptions).toEqual([{ file: 'src/a.test.ts', title: 'a breaks', status: 'failed', retries: 0, error: 'AssertionError: expected 1 to be 2' }]);
  });

  it('keeps the path as it is without a workspace', () => {
    // Act
    const result = summarizeVitestJson(report);

    // Assert
    expect(result.exceptions[0]?.file).toBe('/work/repo/src/a.test.ts');
  });

  it('refuses a report without testResults', () => {
    // Act
    const summarize = () => summarizeVitestJson({});

    // Assert
    expect(summarize).toThrow();
  });
});

describe('summarizePlaywright', () => {
  const failedFirst = { status: 'failed', retry: 0, error: { message: '\u001b[31mTimeout\u001b[39m 5000ms\nmore' } };

  it('walks nested suites and reads the status of each test', () => {
    // Arrange
    const report = {
      suites: [
        {
          title: 'feeds.spec.ts',
          specs: [{ title: 'adds a feed', file: 'feeds.spec.ts', tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }],
          suites: [{
            title: 'import',
            specs: [
              { title: 'reads opml', file: 'feeds.spec.ts', tests: [{ status: 'flaky', results: [failedFirst, { status: 'passed', retry: 1 }] }] },
              { title: 'rejects', file: 'feeds.spec.ts', tests: [{ status: 'unexpected', results: [failedFirst, failedFirst] }] },
              { title: 'later', file: 'feeds.spec.ts', tests: [{ status: 'skipped', results: [] }] },
            ],
          }],
        },
      ],
    };

    // Act
    const result = summarizePlaywright(report);

    // Assert
    expect(result).toMatchObject({ tests: 4, passed: 2, failed: 1, skipped: 1, flaky: 1 });
    expect(result.exceptions).toEqual([
      { file: 'feeds.spec.ts', title: 'import > reads opml', status: 'flaky', retries: 1, error: 'Timeout 5000ms' },
      { file: 'feeds.spec.ts', title: 'import > rejects', status: 'failed', retries: 1, error: 'Timeout 5000ms' },
    ]);
  });

  it('counts a test of each project separately', () => {
    // Arrange
    const tests = [
      { projectName: 'parallel', status: 'expected', results: [{ status: 'passed' }] },
      { projectName: 'alone', status: 'expected', results: [{ status: 'passed' }] },
    ];

    // Act
    const result = summarizePlaywright({ suites: [{ title: 'a.spec.ts', specs: [{ title: 't', file: 'a.spec.ts', tests }] }] });

    // Assert
    expect(result.tests).toBe(2);
  });

  it('ignores a test with a status it does not know', () => {
    // Act
    const result = summarizePlaywright({ suites: [{ title: 'a', specs: [{ title: 't', file: 'a', tests: [{ status: 'weird', results: [] }] }] }] });

    // Assert
    expect(result.tests).toBe(0);
  });

  it('refuses a report without suites', () => {
    // Act
    const summarize = () => summarizePlaywright({ stats: {} });

    // Assert
    expect(summarize).toThrow();
  });
});

describe('summarizeJunit', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="src/a.test.ts" tests="5">
    <testcase name="passes" classname="src/a.test.ts" file="src/a.test.ts"/>
    <testcase name="fails" classname="src/a.test.ts" file="src/a.test.ts"><failure message="expected 1 to be 2">trace line</failure></testcase>
    <testcase name="errors" classname="src/a.test.ts"><error>boom
second line</error></testcase>
    <testcase name="skips" classname="src/a.test.ts"><skipped/></testcase>
    <testcase name="flakes" classname="src/a.test.ts"><flakyFailure message="timeout" type="E">trace</flakyFailure></testcase>
  </testsuite>
</testsuites>`;

  it('counts failures, errors, skips and retried tests, and lists the failed and flaky ones', () => {
    // Act
    const result = summarizeJunit(xml);

    // Assert
    expect(result).toMatchObject({ tests: 5, passed: 2, failed: 2, skipped: 1, flaky: 1 });
    expect(result.exceptions).toEqual([
      { file: 'src/a.test.ts', title: 'fails', status: 'failed', retries: 0, error: 'expected 1 to be 2' },
      { file: 'src/a.test.ts', title: 'errors', status: 'failed', retries: 0, error: 'boom' },
      { file: 'src/a.test.ts', title: 'flakes', status: 'flaky', retries: 1, error: 'timeout' },
    ]);
  });

  it('reads nested suites and uses the suite name when a test case has no file', () => {
    // Act
    const result = summarizeJunit('<testsuite name="outer"><testsuite name="inner"><testcase name="x"><failure/></testcase></testsuite></testsuite>');

    // Assert
    expect(result.exceptions).toEqual([{ file: 'inner', title: 'x', status: 'failed', retries: 0, error: 'no message' }]);
  });

  it('gives no test for an empty report', () => {
    // Act
    const result = summarizeJunit('<testsuites/>');

    // Assert
    expect(result).toMatchObject({ tests: 0, exceptions: [] });
  });

  it('refuses a document that is not a JUnit report', () => {
    // Act
    const summarize = () => summarizeJunit('<html/>');

    // Assert
    expect(summarize).toThrow('no testsuites or testsuite element');
  });
});

describe('summarizeReport', () => {
  it.each([
    ['a JUnit XML', '<testsuite><testcase name="a" classname="c"/></testsuite>'],
    ['a report of the Vitest reporter', JSON.stringify({ tests: [{ file: 'a', title: 'b', state: 'passed', retries: 0, error: '' }] })],
    ['a Vitest json report', JSON.stringify({ testResults: [{ name: 'a', assertionResults: [{ title: 'b', status: 'passed' }] }] })],
    ['a Playwright json report', JSON.stringify({ suites: [{ title: 'a', specs: [{ title: 't', file: 'a', tests: [{ status: 'expected', results: [] }] }] }] })],
  ])('detects %s from its content', (_label, text) => {
    // Act
    const result = summarizeReport(text);

    // Assert
    expect(result.tests).toBe(1);
  });

  it('refuses a JSON file that is none of the formats', () => {
    // Act
    const summarize = () => summarizeReport('{"a":1}');

    // Assert
    expect(summarize).toThrow('not a JUnit XML, a Vitest JSON or a Playwright JSON');
  });
});

describe('clipError', () => {
  it('keeps the first line, drops terminal colors, and cuts a long line', () => {
    // Act
    const result = clipError(`\u001b[1mfirst ${'x'.repeat(400)}\u001b[22m\nsecond`);

    // Assert
    expect(result).toHaveLength(300);
    expect(result.startsWith('first x')).toBe(true);
  });
});
