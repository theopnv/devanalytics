import { readdir } from 'node:fs/promises';
import type { Collector } from '../../core/contract.ts';
import { downloadArtifacts } from './artifacts.ts';
import type { TestsSnapshot } from './metric.ts';
import { loadReports, parseNamedPaths } from './reports.ts';
import { resolveRun } from './run.ts';

const warn = (message: string): void => {
  process.stderr.write(`warning: ${message}\n`);
};

async function hasRunnerFolders(directory: string): Promise<boolean> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries.some((entry) => entry.isDirectory());
}

export const collector: Collector<TestsSnapshot> = {
  inputs: [
    {
      name: 'reports',
      description: 'One test report on each line, as suite=path. The working-directory has one subfolder for each runner, and the path is relative to that subfolder. The file is a JUnit XML, a Vitest JSON or a Playwright JSON.',
    },
    { name: 'run-id', description: 'The workflow run to record. The default is the run of the workflow_run event, or the current run.' },
    { name: 'run-attempt', description: 'The attempt of the run. The default comes from the same place as run-id.' },
    { name: 'run-started-at', description: 'The start of the run in ISO 8601. The default is the start in the workflow_run event, or the value that GitHub gives for the run.' },
    { name: 'github-token', description: 'A token with actions: read. The collector reads the start of the run with it when no other source has it. When the working-directory has no subfolder, it also downloads the artifacts of the run into it.' },
  ],
  backfill: 'runs',
  async collect({ inputs, cwd, env }) {
    const entries = parseNamedPaths(inputs['reports']);
    if (entries.length === 0) {
      throw new Error('reports: give at least one report, for example unit=unit.json.');
    }
    const run = await resolveRun(inputs, env);
    if (!(await hasRunnerFolders(cwd)) && inputs['github-token']) {
      await downloadArtifacts(env, inputs['github-token'], run.id, cwd, warn);
    }
    const { suites, exceptions } = await loadReports(cwd, entries, warn, env['GITHUB_WORKSPACE']);
    if (suites.length === 0) {
      warn('No test report was found, so this run has no test rows. A run that skipped its tests, such as a documentation change, gives this.');
    }
    return { run_id: run.id, run_attempt: run.attempt, date: run.startedAt, suites, exceptions };
  },
};
