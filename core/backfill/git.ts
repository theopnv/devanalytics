import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../git.ts';
import type { Commit } from '../git.ts';

export interface CommitTarget extends Commit {
  /** What the user named: a tag, a ref, or the short sha. */
  label: string;
}

function parseLog(output: string): Commit[] {
  return output.split('\n').filter(Boolean).map((line) => {
    const [sha = '', date = ''] = line.split('\t');
    return { sha, date };
  });
}

const LOG_FORMAT = '--format=%H%x09%cI';

export function resolveCommit(repo: string, ref: string): Commit {
  let output: string;
  try {
    output = git(repo, 'log', '-1', LOG_FORMAT, `${ref}^{commit}`, '--');
  } catch {
    throw new Error(`The ref "${ref}" is not a commit of ${repo}.`);
  }
  const [commit] = parseLog(output);
  if (!commit) {
    throw new Error(`The ref "${ref}" is not a commit of ${repo}.`);
  }
  return commit;
}

export function listTags(repo: string): string[] {
  return git(repo, 'tag', '--list', '--sort=creatordate').split('\n').filter(Boolean);
}

function hasRef(repo: string, ref: string): boolean {
  try {
    git(repo, 'rev-parse', '--verify', '--quiet', ref);
    return true;
  } catch {
    return false;
  }
}

/** The branch that `--every` walks: the remote default branch, then `main`, then `master`, then HEAD. */
export function defaultBranch(repo: string): string {
  try {
    return git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  } catch {
    return ['main', 'master'].find((name) => hasRef(repo, `refs/heads/${name}`)) ?? 'HEAD';
  }
}

/** Every `step` commits of the first-parent line of `branch`, from the newest, so the newest commit is always one of them. */
export function everyNth(repo: string, branch: string, step: number): Commit[] {
  return parseLog(git(repo, 'log', '--first-parent', LOG_FORMAT, branch, '--')).filter((_commit, index) => index % step === 0);
}

/** Runs `fn` in a detached worktree of the commit. The worktree is always removed. */
export async function inWorktree<R>(repo: string, sha: string, fn: (worktree: string) => Promise<R>): Promise<R> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-worktree-'));
  const worktree = path.join(parent, 'checkout');
  git(repo, 'worktree', 'add', '--detach', worktree, sha);
  try {
    return await fn(worktree);
  } finally {
    git(repo, 'worktree', 'remove', '--force', worktree);
    await rm(parent, { recursive: true, force: true });
  }
}
