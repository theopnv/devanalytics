import type { Collector } from '../../core/contract.ts';
import { headCommit } from '../../core/git.ts';
import type { CoverageSnapshot } from './metric.ts';
import { loadSuites, loadTestCounts, parseNamedPaths } from './reports.ts';

export const collector: Collector<CoverageSnapshot> = {
  inputs: [
    {
      name: 'reports',
      description: 'One coverage report on each line, as suite=path: an Istanbul coverage-final.json or an lcov.info. With two or more reports, the total suite is their union. The paths are relative to working-directory.',
    },
    {
      name: 'test-results',
      description: 'Optional. One test report on each line, as suite=path: a Vitest JSON, a Playwright JSON or a JUnit XML. It fills the test counts of each suite.',
    },
  ],
  backfill: 'commits',
  async collect({ inputs, cwd }) {
    const reports = parseNamedPaths('reports', inputs['reports']);
    const results = parseNamedPaths('test-results', inputs['test-results']);
    const suites = await loadSuites(cwd, reports);
    const tests = results.length > 0 ? await loadTestCounts(cwd, results) : undefined;
    return { ...headCommit(cwd), suites, ...(tests && { tests }) };
  },
};
