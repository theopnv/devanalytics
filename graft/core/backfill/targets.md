# core/backfill/targets.ts

- Target · interface · L5-L13 — interface Target
- Selection · type · L15-L15 — type Selection = { kind: 'tags' } | { kind: 'every'; step: number } | { kind: 'refs'; refs: string[] };
- CommitSelection · interface · L17-L22 — interface CommitSelection
- selectCommits · function · L29-L38 — function selectCommits({ repo, selection, branch }: CommitSelection): CommitTarget[]
- listCommitTargets · function · L41-L52 — function listCommitTargets(options: CommitSelection): Target[]
- RunListing · interface · L54-L61 — interface RunListing
- ApiRun · interface · L63-L68 — interface ApiRun
- retentionStart · function · L71-L73 — function retentionStart(now: Date): Date
- fetchPage · function · L75-L90 — async function fetchPage(listing: RunListing, since: Date, page: number): Promise<ApiRun[]>
- listRunTargets · function · L96-L116 — async function listRunTargets(listing: RunListing): Promise<Target[]>
