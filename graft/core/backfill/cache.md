# core/backfill/cache.ts

- State · interface · L4-L7 — interface State
- Cache · interface · L9-L15 — interface Cache
- readJson · function · L17-L26 — async function readJson(file: string): Promise<unknown>
- writeJson · function · L29-L33 — async function writeJson(file: string, value: unknown): Promise<void>
- parseState · function · L35-L47 — function parseState(value: unknown, file: string, workerUrl: string | undefined): State
- openCache · function · L53-L72 — async function openCache(dir: string, metric: string, workerUrl: string | undefined): Promise<Cache>
- markUploaded · method · L64-L70 — async markUploaded(key)
