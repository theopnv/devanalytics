# core/action/upload.ts

- UploadTarget · interface · L3-L6 — interface UploadTarget
- UploadOptions · interface · L8-L17 — interface UploadOptions
- UploadError · class · L23-L32 — class UploadError extends Error
- constructor · method · L28-L31 — constructor(message: string, status?: number)
- RateLimitError · class · L35-L54 — class RateLimitError extends UploadError
- constructor · method · L43-L48 — constructor(message: string, retryAfter: number | undefined, cost?: number, ceiling?: number)
- tooLarge · method · L51-L53 — get tooLarge(): boolean
- defaultSleep · function · L56-L58 — defaultSleep = (milliseconds: number): Promise<void>
- parseJson · function · L60-L66 — function parseJson(text: string): unknown
- field · function · L68-L70 — function field(value: unknown, name: string): unknown
- errorDetail · function · L72-L75 — function errorDetail(body: string): string
- retryAfterSeconds · function · L77-L81 — function retryAfterSeconds(response: Response): number | undefined
- numberField · function · L83-L86 — function numberField(body: string, name: string): number | undefined
- rateLimitError · function · L88-L95 — function rateLimitError(route: string, response: Response, body: string, now: Date): RateLimitError
- rowsWritten · function · L97-L103 — function rowsWritten(body: string, route: string): number
- upload · function · L109-L143 — async function upload(target: UploadTarget, metric: string, snapshot: unknown, options: UploadOptions = {}): Promise<{ rowsWritten: number }>
