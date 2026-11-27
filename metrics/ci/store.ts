import type { Store } from '../../core/contract.ts';
import type { CiSnapshot } from './metric.ts';

const INSERT_RUNS = `
INSERT INTO ci_runs (run_id, run_attempt, date, sha, workflow, event, branch, conclusion, wall_seconds, labels)
SELECT ?1, ?2, ?3, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, value ->> 6
FROM json_each(?4)`;

const INSERT_JOBS = `
INSERT INTO ci_jobs (run_id, run_attempt, date, job_id, name, runner, os, conclusion, queue_seconds, duration_seconds)
SELECT ?1, ?2, ?3, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, value ->> 6
FROM json_each(?4)`;

const INSERT_STEPS = `
INSERT INTO ci_steps (run_id, run_attempt, date, job_id, number, name, conclusion, duration_seconds)
SELECT ?1, ?2, ?3, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4
FROM json_each(?4)`;

const INSERT_GROUPS = `
INSERT INTO ci_step_groups (run_id, run_attempt, date, job_id, position, name, duration_ms)
SELECT ?1, ?2, ?3, value ->> 0, value ->> 1, value ->> 2, value ->> 3
FROM json_each(?4)`;

export const store: Store<CiSnapshot> = {
  tables: ['ci_runs', 'ci_jobs', 'ci_steps', 'ci_step_groups'],
  toRows(snapshot) {
    const { jobs, labels } = snapshot;
    const labelText = labels && Object.keys(labels).length > 0 ? JSON.stringify(labels) : null;
    return [
      {
        table: 'ci_runs',
        insert: INSERT_RUNS,
        rows: [[snapshot.sha, snapshot.workflow, snapshot.event, snapshot.branch, snapshot.conclusion, snapshot.wall_seconds, labelText]],
      },
      {
        table: 'ci_jobs',
        insert: INSERT_JOBS,
        rows: jobs.map((job) => [job.id, job.name, job.runner, job.os, job.conclusion, job.queue_seconds, job.duration_seconds]),
      },
      {
        table: 'ci_steps',
        insert: INSERT_STEPS,
        rows: jobs.flatMap((job) => job.steps.map((step) => [job.id, step.number, step.name, step.conclusion, step.duration_seconds])),
      },
      {
        table: 'ci_step_groups',
        insert: INSERT_GROUPS,
        rows: jobs.flatMap((job) => job.groups.map((group, position) => [job.id, position, group.name, group.duration_ms])),
      },
    ];
  },
};
