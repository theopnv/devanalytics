import { describe, expect, it } from 'vitest';
import { countJunit, countPlaywright, countTestResults, countVitest } from './testresults.ts';

const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="a" file="src/a.test.ts" tests="3">
    <testcase name="passes" classname="src/a.test.ts" file="src/a.test.ts"/>
    <testcase name="fails" classname="src/a.test.ts" file="src/a.test.ts"><failure message="boom">trace</failure></testcase>
    <testcase name="errors" classname="src/a.test.ts" file="src/a.test.ts"><error message="boom"/></testcase>
  </testsuite>
  <testsuite name="b">
    <testsuite name="nested">
      <testcase name="skips" classname="b.spec"><skipped/></testcase>
      <testcase name="passes" classname="b.spec"/>
    </testsuite>
  </testsuite>
</testsuites>`;

describe('countVitest', () => {
  it('counts the status of each test and one file for each result', () => {
    // Act
    const result = countVitest({ testResults: [
      { assertionResults: [{ status: 'passed' }, { status: 'failed' }] },
      { assertionResults: [{ status: 'skipped' }, { status: 'todo' }, { status: 'pending' }] },
    ] });

    // Assert
    expect(result).toEqual({ files: 2, tests: 5, passed: 1, failed: 1, skipped: 3 });
  });
});

describe('countPlaywright', () => {
  it('counts a flaky test as passed and one file for each suite', () => {
    // Act
    const result = countPlaywright({ suites: [{}, {}, {}], stats: { expected: 10, unexpected: 1, flaky: 2, skipped: 3 } });

    // Assert
    expect(result).toEqual({ files: 3, tests: 16, passed: 12, failed: 1, skipped: 3 });
  });
});

describe('countJunit', () => {
  it('counts failures, errors and skips, through nested suites', () => {
    // Act
    const result = countJunit(JUNIT);

    // Assert
    expect(result).toEqual({ files: 2, tests: 5, passed: 2, failed: 2, skipped: 1 });
  });

  it('reads a report with one testsuite as its root', () => {
    // Act
    const result = countJunit('<testsuite name="a"><testcase name="x" classname="c"/></testsuite>');

    // Assert
    expect(result).toEqual({ files: 1, tests: 1, passed: 1, failed: 0, skipped: 0 });
  });

  it('counts a single test case, which the parser does not give as a list', () => {
    // Act
    const result = countJunit('<testsuites><testsuite><testcase name="x" classname="c"><skipped/></testcase></testsuite></testsuites>');

    // Assert
    expect(result).toEqual({ files: 1, tests: 1, passed: 0, failed: 0, skipped: 1 });
  });

  it('gives zero counts for a report with no test', () => {
    // Act
    const result = countJunit('<testsuites/>');

    // Assert
    expect(result).toEqual({ files: 0, tests: 0, passed: 0, failed: 0, skipped: 0 });
  });
});

describe('countTestResults', () => {
  it.each([
    ['a JUnit XML', JUNIT, 5],
    ['a Vitest JSON', JSON.stringify({ testResults: [{ assertionResults: [{ status: 'passed' }] }] }), 1],
    ['a Playwright JSON', JSON.stringify({ suites: [], stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 0 } }), 2],
  ])('detects %s from its content', (_label, text, tests) => {
    // Act
    const result = countTestResults(text, 'report');

    // Assert
    expect(result.tests).toBe(tests);
  });

  it('refuses a JSON file that is none of the formats', () => {
    // Act
    const count = () => countTestResults('{"a":1}', 'report.json');

    // Assert
    expect(count).toThrow('report.json is not a Vitest JSON');
  });
});
