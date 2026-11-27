import { RateLimitError, upload as sendSnapshot } from '../action/upload.ts';
import type { UploadOptions, UploadTarget } from '../action/upload.ts';
import type { Snapshot } from '../contract.ts';
import type { Cache } from './cache.ts';
import type { Target } from './targets.ts';

/** A collected snapshot that is not uploaded yet. `cost` is the rows that its ingest writes. */
export interface Pending {
  target: Target;
  snapshot: Snapshot;
  cost: number;
}

export type Stop =
  | { reason: 'budget'; retryAfter: number | undefined; remaining: Pending[] }
  | { reason: 'too-large'; pending: Pending; ceiling: number };

export interface UploadSummary {
  sent: number;
  rowsWritten: number;
  stop?: Stop;
}

export interface UploadContext {
  destination: UploadTarget;
  metric: string;
  cache: Cache;
  log(line: string): void;
  uploadOptions?: UploadOptions;
}

/**
 * Uploads the snapshots in the given order, which is date order, and records each one in `state.json` when it is done.
 * It stops at the first 429. Any other error is thrown, and the state keeps the snapshots that are done.
 */
export async function uploadAll(pending: readonly Pending[], context: UploadContext): Promise<UploadSummary> {
  const summary: UploadSummary = { sent: 0, rowsWritten: 0 };
  for (const [index, item] of pending.entries()) {
    try {
      const { rowsWritten } = await sendSnapshot(context.destination, context.metric, item.snapshot, { ...context.uploadOptions, backfill: true });
      await context.cache.markUploaded(item.target.key);
      summary.sent += 1;
      summary.rowsWritten += rowsWritten;
      context.log(`${item.target.label} ${item.target.date.slice(0, 10)}: ${rowsWritten} rows written`);
    } catch (error) {
      if (!(error instanceof RateLimitError)) {
        throw error;
      }
      summary.stop = error.tooLarge && error.ceiling !== undefined
        ? { reason: 'too-large', pending: item, ceiling: error.ceiling }
        : { reason: 'budget', retryAfter: error.retryAfter, remaining: pending.slice(index) };
      return summary;
    }
  }
  return summary;
}
