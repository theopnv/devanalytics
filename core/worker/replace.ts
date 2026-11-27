import type { MetricKey, Snapshot, TableRows } from '../contract.ts';
import { chunks, rowsWritten } from './chunks.ts';

/** The columns that identify one snapshot, and the values that the insert binds before the JSON rows. */
export interface SnapshotKey {
  /** `sha = ?1`, or `run_id = ?1 AND run_attempt = ?2`. */
  where: string;
  values: (string | number)[];
  date: string;
}

export function snapshotKey(kind: MetricKey, snapshot: Snapshot): SnapshotKey {
  if (kind === 'commit' && 'sha' in snapshot) {
    return { where: 'sha = ?1', values: [snapshot.sha], date: snapshot.date };
  }
  if (kind === 'run' && 'run_id' in snapshot) {
    return { where: 'run_id = ?1 AND run_attempt = ?2', values: [snapshot.run_id, snapshot.run_attempt], date: snapshot.date };
  }
  throw new Error(`the snapshot does not have the key columns of a ${kind} metric`);
}

export function countStatements(db: D1Database, key: SnapshotKey, tables: readonly string[]): D1PreparedStatement[] {
  return tables.map((table) => db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${key.where}`).bind(...key.values));
}

/**
 * Replaces the rows of one snapshot in one batch, which D1 runs as a single transaction, so a failed insert keeps the old rows.
 * Every table of the store is cleared, also a table that the new snapshot has no rows for. Returns the rows D1 wrote.
 */
export async function replaceRows(db: D1Database, key: SnapshotKey, storeTables: readonly string[], inserts: TableRows[]): Promise<number> {
  const statements = [
    ...storeTables.map((table) => db.prepare(`DELETE FROM ${table} WHERE ${key.where}`).bind(...key.values)),
    ...inserts.flatMap(({ insert, rows }) => chunks(rows).map((part) => db.prepare(insert).bind(...key.values, key.date, JSON.stringify(part)))),
  ];
  return rowsWritten(await db.batch(statements));
}
