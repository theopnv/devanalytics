# scripts/dev-worker.mts

- Child · interface · L10-L14 — interface Child
- DevWorker · interface · L16-L23 — interface DevWorker
- DevWorkerOptions · interface · L25-L29 — interface DevWorkerOptions
- start · function · L32-L41 — function start(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Child
- run · function · L43-L47 — async function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }>
- stopChild · function · L49-L53 — function stopChild(child: Child): void
- freePort · function · L55-L64 — function freePort(): Promise<number>
- waitForWorker · function · L66-L80 — async function waitForWorker(url: string, dev: Child): Promise<void>
- startDevWorker · function · L83-L128 — async function startDevWorker({ root, vars = {} }: DevWorkerOptions): Promise<DevWorker>
- execute · method · L116-L121 — async execute(sql)
- stop · method · L122-L126 — async stop()
