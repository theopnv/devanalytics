import { describe, expect, it } from 'vitest';
import { parseQuery, QueryError } from '../core/worker/query.ts';

const ALLOWED = ['example_items'];
const REGISTRY = ['example_items', 'other_rows', 'other_totals'];

describe('parseQuery', () => {
  it('accepts a query on an allowed table', () => {
    // Act
    const result = parseQuery({ sql: 'SELECT * FROM example_items;' }, ALLOWED, REGISTRY);

    // Assert
    expect(result).toEqual({ sql: 'SELECT * FROM example_items', params: [] });
  });

  it.each([
    ['a longer name that only starts like a table of another metric', 'SELECT other_rows_count FROM example_items'],
    ['a column named like the usage table', 'SELECT usage_count FROM example_items'],
  ])('does not match %s', (_label, sql) => {
    // Act
    const result = parseQuery({ sql }, ALLOWED, REGISTRY);

    // Assert
    expect(result.sql).toBe(sql);
  });

  it.each([
    ['a table of another metric', 'SELECT * FROM other_rows'],
    ['the second table of another metric', 'SELECT * FROM other_totals'],
    ['a double-quoted name', 'SELECT * FROM "other_rows"'],
    ['a bracketed name', 'SELECT * FROM [other_rows]'],
    ['a backtick name', 'SELECT * FROM `other_totals`'],
    ['a name in mixed case', 'SELECT * FROM Other_Rows'],
    ['a schema-qualified name', 'SELECT * FROM main.other_rows'],
    ['a join with a table of another metric', 'SELECT * FROM example_items JOIN other_rows USING (sha)'],
    ['a CTE that has the name of a table', 'WITH other_rows AS (SELECT 1 AS n) SELECT n FROM other_rows'],
    ['the usage table', 'SELECT * FROM usage'],
    ['the usage table in quotes and capitals', 'SELECT * FROM "Usage"'],
    ['a sqlite_ table', 'SELECT name FROM sqlite_master'],
    ['a sqlite_ table in upper case', 'SELECT name FROM SQLITE_SCHEMA'],
    ['the D1 migrations table', 'SELECT * FROM d1_migrations'],
    ['a Cloudflare table', 'SELECT * FROM _cf_KV'],
    ['a table-valued PRAGMA', 'SELECT * FROM pragma_table_list'],
  ])('refuses %s', (_label, sql) => {
    // Act
    const parse = () => parseQuery({ sql }, ALLOWED, REGISTRY);

    // Assert
    expect(parse).toThrow(QueryError);
  });

  it('allows a table on the route of its own metric', () => {
    // Act
    const result = parseQuery({ sql: 'SELECT * FROM other_rows' }, ['other_rows', 'other_totals'], REGISTRY);

    // Assert
    expect(result.sql).toBe('SELECT * FROM other_rows');
  });

  it.each([
    ['a DELETE', 'DELETE FROM example_items'],
    ['a second statement', 'SELECT 1; SELECT 2'],
    ['no SQL', ''],
  ])('refuses %s', (_label, sql) => {
    // Act
    const parse = () => parseQuery({ sql }, ALLOWED, REGISTRY);

    // Assert
    expect(parse).toThrow(QueryError);
  });

  it('refuses params that are not strings, numbers or nulls', () => {
    // Act
    const parse = () => parseQuery({ sql: 'SELECT ?1', params: [{}] }, ALLOWED, REGISTRY);

    // Assert
    expect(parse).toThrow(QueryError);
  });
});
