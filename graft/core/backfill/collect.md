# core/backfill/collect.ts

- CollectJob · interface · L12-L22 — interface CollectJob
- snapshotId · function · L25-L27 — function snapshotId(snapshot: Snapshot): string
- runCommand · function · L29-L47 — function runCommand(command: string, cwd: string, env: CollectJob['env']): Promise<void>
- keep · function · L32-L34 — keep = (chunk: Buffer): void
- collectorInputs · function · L50-L55 — function collectorInputs({ entry, target, inputs, env }: CollectJob): Record<string, string>
- collectIn · function · L57-L63 — async function collectIn(job: CollectJob, cwd: string): Promise<Snapshot>
- collectTarget · function · L66-L84 — async function collectTarget(job: CollectJob): Promise<Snapshot>
