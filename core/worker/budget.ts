export const DEFAULT_DAILY_LIMIT = 100_000;
export const BACKFILL_HEADER = 'X-Devanalytics-Mode';

const INGEST_SHARE = 0.95;
const BACKFILL_SHARE = 0.7;

export interface Limits {
  /** The rows written for each day above which an ingest is refused. */
  limit: number;
  /** The same ceiling for an ingest with the backfill header. It is lower, so that CI uploads keep room. */
  backfillLimit: number;
}

/** A snapshot that would take the rows written today above the ceiling. */
export class BudgetError extends Error {
  override name = 'BudgetError';

  readonly used: number;
  readonly cost: number;
  readonly ceiling: number;
  readonly retryAfter: number;

  constructor(message: string, used: number, cost: number, ceiling: number, retryAfter: number) {
    super(message);
    this.used = used;
    this.cost = cost;
    this.ceiling = ceiling;
    this.retryAfter = retryAfter;
  }
}

export function limitsFrom(dailyLimit: string | undefined): Limits {
  const parsed = Number(dailyLimit);
  const daily = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_LIMIT;
  return { limit: Math.floor(daily * INGEST_SHARE), backfillLimit: Math.floor(daily * BACKFILL_SHARE) };
}

export function isBackfill(request: Request): boolean {
  return request.headers.get(BACKFILL_HEADER) === 'backfill';
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function secondsUntilUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

export function readUsage(db: D1Database, day: string): D1PreparedStatement {
  return db.prepare('SELECT rows_written AS n FROM usage WHERE day = ?1').bind(day);
}

export function recordUsage(db: D1Database, day: string, rows: number): D1PreparedStatement {
  return db.prepare(
    'INSERT INTO usage (day, rows_written) VALUES (?1, ?2) ON CONFLICT (day) DO UPDATE SET rows_written = rows_written + excluded.rows_written',
  ).bind(day, rows);
}

/** Refuses a snapshot whose rows would take the day above the ceiling. `cost` counts the rows to insert, the rows to delete and the usage row. */
export function checkBudget(used: number, cost: number, ceiling: number, now: Date): void {
  if (used + cost <= ceiling) {
    return;
  }
  const message = cost > ceiling
    ? `the snapshot needs ${cost} rows, and the limit for one day is ${ceiling} rows`
    : `the daily write budget has ${Math.max(ceiling - used, 0)} rows left, and the snapshot needs ${cost}`;
  throw new BudgetError(message, used, cost, ceiling, secondsUntilUtcMidnight(now));
}
