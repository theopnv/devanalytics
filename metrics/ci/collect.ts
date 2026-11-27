import type { Collector } from '../../core/contract.ts';
import { buildSnapshot } from './build.ts';
import { fetchJobs, fetchRun, githubTarget } from './github.ts';
import { parseLabels } from './labels.ts';
import { loadLogGroups } from './logs.ts';
import type { CiSnapshot } from './metric.ts';
import { resolveRunIds } from './run.ts';

const warn = (message: string): void => {
  process.stderr.write(`warning: ${message}\n`);
};

export const collector: Collector<CiSnapshot> = {
  inputs: [
    { name: 'run-id', description: 'The workflow run to record. The default is the run of the workflow_run event, or the current run.' },
    { name: 'run-attempt', description: 'The attempt of the run. The default comes from the same place as run-id.' },
    { name: 'github-token', description: 'A token with actions: read. The collector reads the run, its jobs and their logs with it.' },
    { name: 'labels', description: 'Optional. Free key=value pairs, one on each line, stored with the run as JSON.' },
  ],
  backfill: 'runs',
  async collect({ inputs, env }) {
    const token = inputs['github-token'];
    if (!token) {
      throw new Error('Set the github-token input to a token with actions: read, for example ${{ secrets.GITHUB_TOKEN }}.');
    }
    const labels = parseLabels(inputs['labels']);
    const { id, attempt } = await resolveRunIds(inputs, env);
    const target = githubTarget(env, token);
    const [run, jobs] = await Promise.all([fetchRun(target, id, attempt), fetchJobs(target, id, attempt)]);
    return buildSnapshot(run, jobs, await loadLogGroups(target, jobs, warn), labels);
  },
};
