import type { TableRows, WorkerEntry } from '../contract.ts';
import { checkBudget, readUsage, recordUsage, utcDay } from './budget.ts';
import type { Limits } from './budget.ts';
import { countStatements, replaceRows, snapshotKey } from './replace.ts';
import type { SnapshotKey } from './replace.ts';

export interface IngestOptions {
  backfill: boolean;
  limits: Limits;
  now: Date;
}

function assertOwnTables(allowed: readonly string[], inserts: TableRows[]): void {
  for (const { table } of inserts) {
    if (!allowed.includes(table)) {
      throw new Error(`toRows returned ${table}, which is not in the tables of the store`);
    }
  }
}

/** Reads the rows written today and the rows that the replace deletes, in one round trip. */
async function readState(db: D1Database, day: string, key: SnapshotKey, tables: readonly string[]): Promise<{ used: number; replaced: number }> {
  const [usage, ...counts] = await db.batch<{ n: number }>([readUsage(db, day), ...countStatements(db, key, tables)]);
  return {
    used: usage?.results[0]?.n ?? 0,
    replaced: counts.reduce((total, count) => total + (count.results[0]?.n ?? 0), 0),
  };
}

/**
 * Validates a snapshot, checks the write budget, and replaces the rows of its key.
 * Returns the rows written, which include the one write to `usage`.
 */
export async function ingest(db: D1Database, { metric, store }: WorkerEntry, body: unknown, options: IngestOptions): Promise<{ rowsWritten: number }> {
  const snapshot = metric.parse(body);
  const key = snapshotKey(metric.key, snapshot);
  const inserts = store.toRows(snapshot);
  assertOwnTables(store.tables, inserts);

  const day = utcDay(options.now);
  const { used, replaced } = await readState(db, day, key, store.tables);
  const cost = inserts.reduce((total, { rows }) => total + rows.length, 0) + replaced + 1;
  checkBudget(used, cost, options.backfill ? options.limits.backfillLimit : options.limits.limit, options.now);

  const written = (await replaceRows(db, key, store.tables, inserts)) + 1;
  await recordUsage(db, day, written).run();
  return { rowsWritten: written };
}
