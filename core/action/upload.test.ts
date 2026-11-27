import { describe, expect, test, vi } from 'vitest';
import { RateLimitError, UploadError, upload } from './upload.ts';
import type { UploadOptions } from './upload.ts';

const target = { url: 'https://worker.example', token: 'secret-token' };
const snapshot = { sha: 'a'.repeat(40), date: '2026-01-15T10:00:00.000Z' };

const ok = (rowsWritten = 3): Response => Response.json({ rowsWritten });
const fail = (status: number, body: unknown = { error: 'nope' }, headers: Record<string, string> = {}): Response => Response.json(body, { status, headers });

interface Harness extends UploadOptions {
  fetch: ReturnType<typeof vi.fn<typeof fetch>>;
  sleep: ReturnType<typeof vi.fn<(milliseconds: number) => Promise<void>>>;
}

function options(...responses: (Response | Error)[]): Harness {
  const queue = [...responses];
  return {
    fetch: vi.fn<typeof fetch>(async () => {
      const next = queue.shift();
      if (next instanceof Error) {
        throw next;
      }
      return next ?? ok();
    }),
    sleep: vi.fn<(milliseconds: number) => Promise<void>>(async () => undefined),
    now: () => new Date('2026-01-15T22:00:00.000Z'),
  };
}

describe('upload', () => {
  test('posts the snapshot with the bearer token and returns the rows written', async () => {
    const opts = options(ok(7));

    expect(await upload(target, 'coverage', snapshot, opts)).toEqual({ rowsWritten: 7 });

    const [url, init] = opts.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://worker.example/v1/coverage/ingest');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Authorization': 'Bearer secret-token', 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify(snapshot));
  });

  test('sends the backfill header only when it is asked for', async () => {
    const opts = options(ok());

    await upload(target, 'coverage', snapshot, { ...opts, backfill: true });

    const [, init] = opts.fetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'X-Devanalytics-Mode': 'backfill' });
  });

  test('retries a 5xx answer and a network error with a growing wait', async () => {
    const opts = options(fail(503), new TypeError('fetch failed'), fail(500), ok());

    expect(await upload(target, 'ci', snapshot, opts)).toEqual({ rowsWritten: 3 });

    expect(opts.fetch).toHaveBeenCalledTimes(4);
    expect(opts.sleep.mock.calls).toEqual([[1000], [2000], [4000]]);
  });

  test('stops after the last retry and names the last failure', async () => {
    const opts = options(fail(502, { error: 'bad gateway' }), fail(502, { error: 'bad gateway' }), new TypeError('fetch failed'));

    const error = await upload(target, 'ci', snapshot, { ...opts, retryDelays: [10, 20] }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UploadError);
    expect((error as Error).message).toBe('Ingest on /v1/ci/ingest failed after 3 attempts, because the request failed: fetch failed');
    expect(opts.fetch).toHaveBeenCalledTimes(3);
  });

  test.each([400, 401, 404, 422])('does not retry a %i answer', async (status) => {
    const opts = options(fail(status, { error: 'bad snapshot' }));

    const error = await upload(target, 'ci', snapshot, opts).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).status).toBe(status);
    expect((error as Error).message).toBe(`Ingest on /v1/ci/ingest failed with ${status}: bad snapshot`);
    expect(opts.fetch).toHaveBeenCalledTimes(1);
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  test('fails a 429 at once and gives the Retry-After time in the message', async () => {
    const opts = options(fail(429, { error: 'the daily write budget has 0 rows left' }, { 'Retry-After': '7200' }));

    const error = await upload(target, 'ci', snapshot, opts).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(7200);
    expect((error as Error).message).toBe(
      'Ingest on /v1/ci/ingest was refused by the write budget: the daily write budget has 0 rows left. Try again in 7200 seconds, after 2026-01-16T00:00:00.000Z.',
    );
    expect(opts.fetch).toHaveBeenCalledTimes(1);
  });

  test('reads the rows that the snapshot needs and the ceiling from a 429 body, and tells a snapshot that is too large', async () => {
    const tooLarge = await upload(target, 'ci', snapshot, options(fail(429, { error: 'x', cost: 41, limit: 35 }, { 'Retry-After': '60' }))).catch((caught: unknown) => caught);
    const full = await upload(target, 'ci', snapshot, options(fail(429, { error: 'x', cost: 5, limit: 35 }, { 'Retry-After': '60' }))).catch((caught: unknown) => caught);

    expect([(tooLarge as RateLimitError).cost, (tooLarge as RateLimitError).ceiling, (tooLarge as RateLimitError).tooLarge]).toEqual([41, 35, true]);
    expect([(full as RateLimitError).cost, (full as RateLimitError).tooLarge]).toEqual([5, false]);
  });

  test('does not call a 429 too large when the body has no numbers', async () => {
    const error = await upload(target, 'ci', snapshot, options(fail(429))).catch((caught: unknown) => caught);

    expect((error as RateLimitError).tooLarge).toBe(false);
  });

  test('fails a 429 that has no Retry-After header', async () => {
    const error = await upload(target, 'ci', snapshot, options(fail(429))).catch((caught: unknown) => caught);

    expect((error as RateLimitError).retryAfter).toBeUndefined();
    expect((error as Error).message).toContain('Try again after 00:00 UTC.');
  });

  test('shows the text of a body that is not JSON', async () => {
    const error = await upload(target, 'ci', snapshot, options(new Response('<html>Forbidden</html>', { status: 403 }))).catch((caught: unknown) => caught);

    expect((error as Error).message).toBe('Ingest on /v1/ci/ingest failed with 403: <html>Forbidden</html>');
  });

  test('refuses a success answer that does not give the rows written', async () => {
    const error = await upload(target, 'ci', snapshot, options(Response.json({ ok: true }))).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UploadError);
    expect((error as Error).message).toContain('not valid');
  });

  test('never puts the token in an error message', async () => {
    const error = await upload(target, 'ci', snapshot, options(fail(401, { error: 'unauthorized' }))).catch((caught: unknown) => caught);

    expect((error as Error).message).not.toContain('secret-token');
  });
});
