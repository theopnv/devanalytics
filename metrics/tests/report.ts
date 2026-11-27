import { stripVTControlCharacters } from 'node:util';
import { XMLParser } from 'fast-xml-parser';

export interface TestException {
  file: string;
  title: string;
  status: 'failed' | 'flaky';
  retries: number;
  error: string;
}

/** The counts of one test suite. A flaky test passed on a retry, so it is part of `passed`. */
export interface SuiteReport {
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  exceptions: TestException[];
}

export type TestState = 'passed' | 'failed' | 'skipped';

const MAX_TEXT = 300;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Keeps the first line of an error without terminal colors, so a table cell stays short. */
export function clipError(message: string): string {
  const [first = ''] = stripVTControlCharacters(message).trim().split('\n');
  return first.slice(0, MAX_TEXT);
}

function clipText(text: string): string {
  return text.slice(0, MAX_TEXT);
}

const emptyReport = (): SuiteReport => ({ tests: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, exceptions: [] });

function record(report: SuiteReport, state: TestState, retries: number, exception: Omit<TestException, 'status' | 'retries'>): void {
  report.tests += 1;
  if (state === 'skipped') {
    report.skipped += 1;
    return;
  }
  if (state === 'failed') {
    report.failed += 1;
    report.exceptions.push({ ...exception, status: 'failed', retries });
    return;
  }
  report.passed += 1;
  if (retries > 0) {
    report.flaky += 1;
    report.exceptions.push({ ...exception, status: 'flaky', retries });
  }
}

function isState(value: unknown): value is TestState {
  return value === 'passed' || value === 'failed' || value === 'skipped';
}

/**
 * Counts the tests of a report from `action/reporters/vitest.mjs`, which says which test passed on a retry.
 * The file can come from a pull request, so every field is checked.
 */
export function summarizeVitestReporter(value: unknown): SuiteReport {
  if (!isRecord(value) || !Array.isArray(value['tests'])) {
    throw new Error('The Vitest report has no tests array.');
  }
  const report = emptyReport();
  for (const entry of value['tests']) {
    if (!isRecord(entry) || !isState(entry['state'])) {
      throw new Error('The Vitest report has a test without a valid state.');
    }
    const retries = Number.isSafeInteger(entry['retries']) ? Math.max(0, entry['retries'] as number) : 0;
    record(report, entry['state'], retries, {
      file: clipText(textOf(entry['file'])) || 'unknown',
      title: clipText(textOf(entry['title'])) || 'unknown',
      error: clipError(textOf(entry['error'])) || 'no message',
    });
  }
  return report;
}

function vitestState(status: unknown): TestState {
  return status === 'passed' || status === 'failed' ? status : 'skipped';
}

/** Makes an absolute path of the CI machine relative to the workspace, so that the same file has the same name on every runner. */
function relativeFile(file: string, root: string | undefined): string {
  const prefix = root ? `${root.replace(/[\\/]+$/, '')}/` : '';
  return clipText(prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file) || 'unknown';
}

function recordVitestFile(report: SuiteReport, file: Json, root: string | undefined): void {
  for (const test of listOf(file['assertionResults']).filter(isRecord)) {
    record(report, vitestState(test['status']), 0, {
      file: relativeFile(textOf(file['name']), root),
      title: clipText(textOf(test['fullName']) || textOf(test['title'])) || 'unknown',
      error: clipError(textOf(listOf(test['failureMessages'])[0])) || 'no message',
    });
  }
}

/** Counts the tests of the `json` reporter of Vitest. That reporter does not say which test passed on a retry, so no test is flaky. */
export function summarizeVitestJson(value: unknown, root?: string): SuiteReport {
  if (!isRecord(value) || !Array.isArray(value['testResults'])) {
    throw new Error('The Vitest report has no testResults array.');
  }
  const report = emptyReport();
  for (const file of value['testResults'].filter(isRecord)) {
    recordVitestFile(report, file, root);
  }
  return report;
}

function playwrightState(status: unknown): TestState | undefined {
  if (status === 'expected' || status === 'flaky') {
    return 'passed';
  }
  if (status === 'unexpected') {
    return 'failed';
  }
  return status === 'skipped' ? 'skipped' : undefined;
}

/** The error of the first attempt that failed, which is the one a flaky test shows. */
function firstError(results: unknown[]): string {
  for (const result of results) {
    if (isRecord(result) && result['status'] !== 'passed' && isRecord(result['error'])) {
      return clipError(textOf(result['error']['message']));
    }
  }
  return '';
}

function recordPlaywrightTest(report: SuiteReport, test: unknown, file: string, title: string): void {
  const state = isRecord(test) ? playwrightState(test['status']) : undefined;
  if (!isRecord(test) || !state) {
    return;
  }
  const results = listOf(test['results']);
  record(report, state, Math.max(0, results.length - 1), { file, title, error: firstError(results) || 'no message' });
}

function walkSpecs(suite: Json, titles: string[], report: SuiteReport): void {
  for (const spec of listOf(suite['specs']).filter(isRecord)) {
    const title = clipText([...titles, textOf(spec['title'])].join(' > '));
    const file = clipText(textOf(spec['file'])) || 'unknown';
    listOf(spec['tests']).forEach((test) => recordPlaywrightTest(report, test, file, title));
  }
  for (const child of listOf(suite['suites']).filter(isRecord)) {
    walkSpecs(child, [...titles, textOf(child['title'])], report);
  }
}

/** Counts the tests of a Playwright `json` report. The top suites are files, so their titles stay out of the test title. The file is relative to the test folder of Playwright. */
export function summarizePlaywright(value: unknown): SuiteReport {
  if (!isRecord(value) || !Array.isArray(value['suites'])) {
    throw new Error('The Playwright report has no suites array.');
  }
  const report = emptyReport();
  for (const file of value['suites']) {
    if (isRecord(file)) {
      walkSpecs(file, [], report);
    }
  }
  return report;
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/** The message of a `failure` or `error` element. The parser gives a string for a bare element and an object when it has attributes. */
function junitMessage(node: unknown): string {
  const first = asList(node)[0];
  if (isRecord(first)) {
    return clipError(textOf(first['@_message']) || textOf(first['#text']));
  }
  return clipError(textOf(first));
}

function junitCases(node: Json, suiteName: string): { testCase: Json; suiteName: string }[] {
  const name = textOf(node['@_name']) || suiteName;
  return [
    ...asList(node['testcase']).filter(isRecord).map((testCase) => ({ testCase, suiteName: name })),
    ...asList(node['testsuite']).filter(isRecord).flatMap((child) => junitCases(child, name)),
  ];
}

function junitState(testCase: Json): { state: TestState; retries: number; error: string } {
  if ('failure' in testCase || 'error' in testCase) {
    return { state: 'failed', retries: 0, error: junitMessage(testCase['failure'] ?? testCase['error']) };
  }
  if ('skipped' in testCase) {
    return { state: 'skipped', retries: 0, error: '' };
  }
  // Maven Surefire writes each failed attempt of a test that passed on a retry.
  const attempts = [...asList(testCase['flakyFailure']), ...asList(testCase['flakyError'])];
  return { state: 'passed', retries: attempts.length, error: junitMessage(attempts[0]) };
}

/** Counts the test cases of a JUnit XML report. The file of a test is its `file`, its `classname`, or the name of its test suite. */
export function summarizeJunit(xml: string): SuiteReport {
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml) as Json;
  const root = parsed['testsuites'] ?? parsed['testsuite'];
  if (root === undefined) {
    throw new Error('The JUnit report has no testsuites or testsuite element.');
  }
  const report = emptyReport();
  for (const { testCase, suiteName } of junitCases(isRecord(root) ? root : {}, '')) {
    const { state, retries, error } = junitState(testCase);
    record(report, state, retries, {
      file: clipText(textOf(testCase['@_file']) || textOf(testCase['@_classname']) || suiteName) || 'unknown',
      title: clipText(textOf(testCase['@_name'])) || 'unknown',
      error: error || 'no message',
    });
  }
  return report;
}

/**
 * Reads a JUnit XML, a Vitest JSON (from the reporter of this project or from the `json` reporter) or a Playwright JSON report.
 * The content gives the format. `root` is the workspace path, which a Vitest `json` report has in its file names.
 */
export function summarizeReport(text: string, root?: string): SuiteReport {
  if (text.trimStart().startsWith('<')) {
    return summarizeJunit(text);
  }
  const data = JSON.parse(text) as unknown;
  if (isRecord(data) && Array.isArray(data['tests'])) {
    return summarizeVitestReporter(data);
  }
  if (isRecord(data) && Array.isArray(data['testResults'])) {
    return summarizeVitestJson(data, root);
  }
  if (isRecord(data) && Array.isArray(data['suites'])) {
    return summarizePlaywright(data);
  }
  throw new Error('The file is not a JUnit XML, a Vitest JSON or a Playwright JSON report.');
}
