# test/dashboards.test.ts

- Column · interface · L8-L11 — interface Column
- Target · interface · L13-L19 — interface Target
- Panel · interface · L21-L26 — interface Panel
- Variable · interface · L28-L31 — interface Variable
- Dashboard · interface · L33-L37 — interface Dashboard
- QueryBody · interface · L39-L42 — interface QueryBody
- metricOf · function · L47-L47 — metricOf = (file: string): string
- send · function · L49-L55 — function send(path: string, token: string, body: unknown): Promise<Response>
- interpolate · function · L58-L60 — function interpolate(data: string, values: Record<string, string>): string
- run · function · L62-L66 — async function run(metric: string, target: Target, values: Record<string, string>)
- checkColumns · function · L68-L84 — function checkColumns(target: Target, rows: Record<string, unknown>[]): void
- combinations · function · L86-L91 — function combinations(options: Record<string, string[]>): Record<string, string>[]
