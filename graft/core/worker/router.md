# core/worker/router.ts

- json · function · L10-L10 — json = (body: unknown, status = 200)
- Handler · type · L12-L12 — type Handler = (request: Request, env: Env) => Promise<Response>;
- Route · interface · L14-L17 — interface Route
- readJson · function · L19-L25 — async function readJson(request: Request): Promise<unknown>
- ingestRoute · function · L27-L35 — function ingestRoute(entry: WorkerEntry): Handler
- queryRoute · function · L37-L44 — function queryRoute(entry: WorkerEntry, registryTables: readonly string[]): Handler
- badgeRoute · function · L47-L54 — function badgeRoute(badge: NonNullable<WorkerEntry['store']['badge']>): Handler
- usageRoute · function · L56-L63 — usageRoute: Handler = async (request, env)
- metricRoutes · function · L65-L75 — function metricRoutes(entry: WorkerEntry, registryTables: readonly string[]): [string, Route][]
- errorResponse · function · L77-L91 — function errorResponse(error: unknown): Response
- createWorker · function · L94-L117 — function createWorker(registry: readonly WorkerEntry[])
- fetch · method · L102-L115 — async fetch(request: Request, env: Env): Promise<Response>
