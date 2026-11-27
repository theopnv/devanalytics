import { BACKFILL_HEADER } from '../worker/budget.ts';

export interface UploadTarget {
  url: string;
  token: string;
}

export interface UploadOptions {
  /** Sends the backfill header, so the Worker applies the lower daily ceiling. */
  backfill?: boolean;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  /** The wait before each retry. The number of retries is the length of the array. */
  retryDelays?: readonly number[];
  timeout?: number;
}

export const RETRY_DELAYS = [1000, 2000, 4000] as const;
const REQUEST_TIMEOUT = 30_000;
const MAX_DETAIL = 300;

export class UploadError extends Error {
  override name = 'UploadError';

  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** The Worker refused the snapshot because of the daily write budget. A retry before `retryAfter` fails again. */
export class RateLimitError extends UploadError {
  override name = 'RateLimitError';

  readonly retryAfter: number | undefined;
  /** The rows that the snapshot needs, and the ceiling of the day, when the Worker says them. */
  readonly cost: number | undefined;
  readonly ceiling: number | undefined;

  constructor(message: string, retryAfter: number | undefined, cost?: number, ceiling?: number) {
    super(message, 429);
    this.retryAfter = retryAfter;
    this.cost = cost;
    this.ceiling = ceiling;
  }

  /** A snapshot that needs more rows than the ceiling of one day fails on every day. */
  get tooLarge(): boolean {
    return this.cost !== undefined && this.ceiling !== undefined && this.cost > this.ceiling;
  }
}

const defaultSleep = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[name] : undefined;
}

function errorDetail(body: string): string {
  const message = field(parseJson(body), 'error');
  return typeof message === 'string' ? message : body.trim().slice(0, MAX_DETAIL);
}

function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('Retry-After');
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function numberField(body: string, name: string): number | undefined {
  const value = field(parseJson(body), name);
  return typeof value === 'number' ? value : undefined;
}

function rateLimitError(route: string, response: Response, body: string, now: Date): RateLimitError {
  const seconds = retryAfterSeconds(response);
  const detail = errorDetail(body);
  const when = seconds === undefined
    ? 'Try again after 00:00 UTC.'
    : `Try again in ${seconds} seconds, after ${new Date(now.getTime() + seconds * 1000).toISOString()}.`;
  return new RateLimitError(`Ingest on ${route} was refused by the write budget: ${detail}. ${when}`, seconds, numberField(body, 'cost'), numberField(body, 'limit'));
}

function rowsWritten(body: string, route: string): number {
  const written = field(parseJson(body), 'rowsWritten');
  if (typeof written !== 'number') {
    throw new UploadError(`Ingest on ${route} gave a response that is not valid: ${body.slice(0, MAX_DETAIL)}`);
  }
  return written;
}

/**
 * Sends a snapshot to `/v1/<metric>/ingest`, which replaces every row of its key.
 * A 5xx answer and a network error are retried with a growing wait. A 429 and every other 4xx fail at once.
 */
export async function upload(target: UploadTarget, metric: string, snapshot: unknown, options: UploadOptions = {}): Promise<{ rowsWritten: number }> {
  const { fetch: send = fetch, sleep = defaultSleep, now = () => new Date(), retryDelays = RETRY_DELAYS, timeout = REQUEST_TIMEOUT } = options;
  const route = `/v1/${metric}/ingest`;
  const headers: Record<string, string> = { 'Authorization': `Bearer ${target.token}`, 'Content-Type': 'application/json' };
  if (options.backfill) {
    headers[BACKFILL_HEADER] = 'backfill';
  }
  const body = JSON.stringify(snapshot);

  let failure = '';
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelays[attempt - 1] ?? 0);
    }
    let response: Response;
    try {
      response = await send(`${target.url}${route}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      failure = `the request failed: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    const text = await response.text();
    if (response.ok) {
      return { rowsWritten: rowsWritten(text, route) };
    }
    if (response.status === 429) {
      throw rateLimitError(route, response, text, now());
    }
    if (response.status < 500) {
      throw new UploadError(`Ingest on ${route} failed with ${response.status}: ${errorDetail(text)}`, response.status);
    }
    failure = `the Worker answered ${response.status}: ${errorDetail(text)}`;
  }
  throw new UploadError(`Ingest on ${route} failed after ${retryDelays.length + 1} attempts, because ${failure}`);
}
