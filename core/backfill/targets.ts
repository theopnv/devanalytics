import { defaultBranch, everyNth, listTags, resolveCommit } from './git.ts';
import type { CommitTarget } from './git.ts';

/** One snapshot to collect. `key` names its cache file and its entry in `state.json`, and it is the key of the snapshot. */
export interface Target {
  key: string;
  label: string;
  date: string;
  /** Collector inputs that belong to this target, such as `run-id`. */
  inputs: Record<string, string>;
  /** The commit to check out. A target of a `runs` metric has none. */
  sha?: string;
}

export type Selection = { kind: 'tags' } | { kind: 'every'; step: number } | { kind: 'refs'; refs: string[] };

export interface CommitSelection {
  repo: string;
  selection: Selection;
  since?: Date | undefined;
  branch?: string | undefined;
}

/** GitHub keeps the logs and the artifacts of a run for 90 days by default. */
export const RUN_RETENTION_DAYS = 90;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

function selectCommits({ repo, selection, branch }: CommitSelection): CommitTarget[] {
  switch (selection.kind) {
    case 'tags':
      return listTags(repo).map((tag) => ({ label: tag, ...resolveCommit(repo, tag) }));
    case 'refs':
      return selection.refs.map((ref) => ({ label: ref, ...resolveCommit(repo, ref) }));
    case 'every':
      return everyNth(repo, branch ?? defaultBranch(repo), selection.step).map((commit) => ({ label: commit.sha.slice(0, 7), ...commit }));
  }
}

/** The targets are oldest first, one for each commit. When two tags point to one commit, the first one names it. */
export function listCommitTargets(options: CommitSelection): Target[] {
  const since = options.since?.getTime() ?? Number.NEGATIVE_INFINITY;
  const bySha = new Map<string, CommitTarget>();
  for (const commit of selectCommits(options)) {
    if (Date.parse(commit.date) >= since && !bySha.has(commit.sha)) {
      bySha.set(commit.sha, commit);
    }
  }
  return [...bySha.values()]
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .map(({ sha, date, label }) => ({ key: sha, label: label === sha.slice(0, 7) ? label : `${label} ${sha.slice(0, 7)}`, date, inputs: {}, sha }));
}

export interface RunListing {
  /** `owner/name`. */
  repo: string;
  since: Date;
  token: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

interface ApiRun {
  id: number;
  run_attempt: number;
  run_started_at?: string | null;
  created_at: string;
}

/** The oldest date that GitHub can still serve. A `since` before it is moved up to it. */
export function retentionStart(now: Date): Date {
  return new Date(now.getTime() - RUN_RETENTION_DAYS * 24 * 3600 * 1000);
}

async function fetchPage(listing: RunListing, since: Date, page: number): Promise<ApiRun[]> {
  const send = listing.fetch ?? fetch;
  const query = new URLSearchParams({ status: 'completed', created: `>=${since.toISOString().slice(0, 10)}`, per_page: String(PAGE_SIZE), page: String(page) });
  const response = await send(`https://api.github.com/repos/${listing.repo}/actions/runs?${query}`, {
    headers: {
      'Authorization': `Bearer ${listing.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub refused the list of runs of ${listing.repo} with ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const body = await response.json() as { workflow_runs?: ApiRun[] };
  return body.workflow_runs ?? [];
}

/**
 * Lists the completed runs of the last 90 days, oldest first. GitHub gives only the newest attempt of a run,
 * so the earlier attempts of a re-run are not listed.
 */
export async function listRunTargets(listing: RunListing): Promise<Target[]> {
  const since = new Date(Math.max(listing.since.getTime(), retentionStart((listing.now ?? (() => new Date()))()).getTime()));
  const runs: ApiRun[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await fetchPage(listing, since, page);
    runs.push(...batch);
    if (batch.length < PAGE_SIZE) {
      break;
    }
  }
  return runs
    .map((run) => ({ run, date: run.run_started_at ?? run.created_at }))
    .filter(({ date }) => Date.parse(date) >= since.getTime())
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .map(({ run, date }) => ({
      key: `${run.id}-${run.run_attempt}`,
      label: `run ${run.id} attempt ${run.run_attempt}`,
      date,
      inputs: { 'run-id': String(run.id), 'run-attempt': String(run.run_attempt) },
    }));
}
