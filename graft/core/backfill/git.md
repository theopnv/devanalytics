# core/backfill/git.ts

- CommitTarget · interface · L7-L10 — interface CommitTarget extends Commit
- parseLog · function · L12-L17 — function parseLog(output: string): Commit[]
- resolveCommit · function · L21-L33 — function resolveCommit(repo: string, ref: string): Commit
- listTags · function · L35-L37 — function listTags(repo: string): string[]
- hasRef · function · L39-L46 — function hasRef(repo: string, ref: string): boolean
- defaultBranch · function · L49-L55 — function defaultBranch(repo: string): string
- everyNth · function · L58-L60 — function everyNth(repo: string, branch: string, step: number): Commit[]
- inWorktree · function · L63-L73 — async function inWorktree<R>(repo: string, sha: string, fn: (worktree: string) => Promise<R>): Promise<R>
