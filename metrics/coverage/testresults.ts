import { XMLParser } from 'fast-xml-parser';
import type { TestCounts } from './metric.ts';

interface VitestResults {
  testResults: { assertionResults: { status: string }[] }[];
}

interface PlaywrightResults {
  suites: unknown[];
  stats: { expected: number; unexpected: number; flaky: number; skipped: number };
}

type XmlNode = Record<string, unknown>;

const empty = (): TestCounts => ({ files: 0, tests: 0, passed: 0, failed: 0, skipped: 0 });

function add(counts: TestCounts, status: string): void {
  counts.tests += 1;
  if (status === 'passed') {
    counts.passed += 1;
  } else if (status === 'failed') {
    counts.failed += 1;
  } else {
    // pending, skipped, todo and disabled tests did not run.
    counts.skipped += 1;
  }
}

export function countVitest({ testResults }: VitestResults): TestCounts {
  const counts = empty();
  counts.files = testResults.length;
  testResults.forEach((file) => file.assertionResults.forEach((test) => add(counts, test.status)));
  return counts;
}

/** A flaky test passed on a retry, so it counts as passed. */
export function countPlaywright({ suites, stats }: PlaywrightResults): TestCounts {
  const passed = stats.expected + stats.flaky;
  return { files: suites.length, tests: passed + stats.unexpected + stats.skipped, passed, failed: stats.unexpected, skipped: stats.skipped };
}

const asList = (value: unknown): XmlNode[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]) as XmlNode[];

function testCases(node: XmlNode): XmlNode[] {
  return [...asList(node['testcase']), ...asList(node['testsuite']).flatMap(testCases)];
}

/** A file is the `file` or the `classname` of a test case. Reporters differ, so the count is a close estimate. */
export function countJunit(xml: string): TestCounts {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const root = parser.parse(xml) as XmlNode;
  const cases = testCases({ testsuite: root['testsuites'] ?? root['testsuite'] });
  const counts = empty();
  const files = new Set<unknown>();
  for (const testCase of cases) {
    files.add(testCase['@_file'] ?? testCase['@_classname']);
    add(counts, 'failure' in testCase || 'error' in testCase ? 'failed' : 'skipped' in testCase ? 'skipped' : 'passed');
  }
  counts.files = files.size;
  return counts;
}

/** Reads a Vitest JSON, a Playwright JSON or a JUnit XML report. The content gives the format. */
export function countTestResults(text: string, name: string): TestCounts {
  if (text.trimStart().startsWith('<')) {
    return countJunit(text);
  }
  const data = JSON.parse(text) as Partial<VitestResults & PlaywrightResults>;
  if (Array.isArray(data.testResults)) {
    return countVitest(data as VitestResults);
  }
  if (Array.isArray(data.suites) && data.stats) {
    return countPlaywright(data as PlaywrightResults);
  }
  throw new Error(`${name} is not a Vitest JSON, a Playwright JSON or a JUnit XML report`);
}
