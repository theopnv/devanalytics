# test/worker.test.ts

- RunsSnapshot · interface · L16-L18 — interface RunsSnapshot extends RunSnapshot
- parse · method · L23-L29 — parse(body)
- badge · method · L39-L45 — async badge(_db, params)
- withLimit · function · L51-L53 — function withLimit(limit: string): Env
- request · function · L55-L61 — function request(path: string, { method = 'POST', token, body, headers = {} }: { method?: string; token?: string | null; body?: unknown; headers?: Record<string, string> } = {}): Request
- call · function · L63-L65 — function call(path: string, options?: Parameters<typeof request>[1], limit = '100000'): Promise<Response>
- items · function · L67-L69 — function items(count: number): { name: string; value: number }[]
- exampleSnapshot · function · L71-L71 — exampleSnapshot = (count: number, sha = SHA)
- count · function · L73-L76 — async function count(table: string): Promise<number>
- usedToday · function · L78-L81 — async function usedToday(): Promise<number>
- run · function · L170-L170 — run = (run_attempt: number, names: string[])
- ingestWith · function · L364-L368 — ingestWith = (count: number, { limit = '100', backfill = false, sha = SHA } = {})
