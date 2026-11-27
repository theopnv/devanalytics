# core/worker/query.ts

- QueryError · class · L8-L10 — class QueryError extends Error
- QueryRequest · interface · L12-L15 — interface QueryRequest
- parseParams · function · L17-L27 — function parseParams(value: unknown): QueryRequest['params']
- checkTables · function · L34-L40 — function checkTables(sql: string, allowedTables: readonly string[], registryTables: readonly string[]): void
- parseQuery · function · L47-L62 — function parseQuery(value: unknown, allowedTables: readonly string[], registryTables: readonly string[]): QueryRequest
- runQuery · function · L64-L74 — async function runQuery(db: D1Database, { sql, params }: QueryRequest)
