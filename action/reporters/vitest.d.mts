export interface TestCaseLike {
  fullName: string;
  module: { moduleId: string };
  result: () => { state: string; errors?: readonly { message?: string }[] };
  diagnostic: () => { retryCount: number } | undefined;
  attempts: () => readonly { state: string; errors?: readonly { message?: string }[] }[];
}

export interface TestModuleLike {
  children: { allTests: () => Iterable<TestCaseLike> };
}

export interface ReportedTest {
  file: string;
  title: string;
  state: 'passed' | 'failed' | 'skipped';
  retries: number;
  error: string;
}

export function toReport(modules: Iterable<TestModuleLike>, root: string): { tests: ReportedTest[] };

export default class DevanalyticsReporter {
  onTestRunEnd(modules: ReadonlyArray<TestModuleLike>): void;
}
