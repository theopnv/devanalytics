import { execFileSync } from 'node:child_process';

/** Runs git in `repo` without a shell, so a ref or a path cannot become a command. */
export function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trim();
}

export interface Commit {
  sha: string;
  /** The commit date in ISO 8601, which is the `date` of a snapshot. */
  date: string;
}

/** The commit that is checked out in `repo`. In a backfill worktree, it is the target commit. */
export function headCommit(repo: string): Commit {
  const [sha = '', date = ''] = git(repo, 'show', '-s', '--format=%H%n%cI', 'HEAD').split('\n');
  return { sha, date };
}
