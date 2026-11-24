import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

describe('scaffold', () => {
  test('answers unknown routes with 404', async () => {
    const response = await exports.default.fetch('https://example.com/unknown');

    expect(response.status).toBe(404);
  });

  test('binds the database, the tokens and the write limit', async () => {
    const row = await env.DB.prepare('SELECT 1 AS one').first<{ one: number }>();

    expect(row?.one).toBe(1);
    expect(env.INGEST_TOKEN).toBe('test-ingest-token');
    expect(env.QUERY_TOKEN).toBe('test-query-token');
    expect(env.DAILY_WRITE_LIMIT).toBe('100000');
  });
});
