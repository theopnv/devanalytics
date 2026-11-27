# core/worker/ingest.ts

- IngestOptions · interface · L7-L11 — interface IngestOptions
- assertOwnTables · function · L13-L19 — function assertOwnTables(allowed: readonly string[], inserts: TableRows[]): void
- readState · function · L22-L28 — async function readState(db: D1Database, day: string, key: SnapshotKey, tables: readonly string[]): Promise<{ used: number; replaced: number }>
- ingest · function · L34-L48 — async function ingest(db: D1Database, { metric, store }: WorkerEntry, body: unknown, options: IngestOptions): Promise<{ rowsWritten: number }>
