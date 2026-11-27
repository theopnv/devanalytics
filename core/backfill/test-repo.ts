import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface FixtureCommit {
  /** The commit date, in ISO 8601. */
  date: string;
  files?: Record<string, string>;
  tags?: string[];
}

export interface FixtureRepo {
  path: string;
  /** The sha of each commit, oldest first. */
  shas: string[];
  remove(): Promise<void>;
}

/** A temporary git repository with one commit for each entry. The first commit is on `main`. */
export async function makeRepo(commits: readonly FixtureCommit[]): Promise<FixtureRepo> {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'devanalytics-repo-'));
  const git = (date: string, ...args: string[]): string => execFileSync(
    'git',
    ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args],
    { env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date }, encoding: 'utf8' },
  ).trim();

  git('2000-01-01T00:00:00Z', 'init', '-q', '-b', 'main');
  const shas: string[] = [];
  for (const { date, files = {}, tags = [] } of commits) {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(repo, name)), { recursive: true });
      await writeFile(path.join(repo, name), content);
    }
    git(date, 'add', '-A');
    git(date, 'commit', '--allow-empty', '-q', '-m', `commit ${shas.length + 1}`);
    for (const tag of tags) {
      git(date, 'tag', tag);
    }
    shas.push(git(date, 'rev-parse', 'HEAD'));
  }
  return { path: repo, shas, remove: () => rm(repo, { recursive: true, force: true }) };
}
