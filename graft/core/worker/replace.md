# core/worker/replace.ts

- SnapshotKey · interface · L5-L10 — interface SnapshotKey
- snapshotKey · function · L12-L20 — function snapshotKey(kind: MetricKey, snapshot: Snapshot): SnapshotKey
- countStatements · function · L22-L24 — function countStatements(db: D1Database, key: SnapshotKey, tables: readonly string[]): D1PreparedStatement[]
- replaceRows · function · L30-L36 — async function replaceRows(db: D1Database, key: SnapshotKey, storeTables: readonly string[], inserts: TableRows[]): Promise<number>
