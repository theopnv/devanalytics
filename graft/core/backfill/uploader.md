# core/backfill/uploader.ts

- Pending · interface · L8-L12 — interface Pending
- Stop · type · L14-L16 — type Stop = | { reason: 'budget'; retryAfter: number | undefined; remaining: Pending[] } | { reason: 'too-large'; pending: Pending; ceiling: number };
- UploadSummary · interface · L18-L22 — interface UploadSummary
- UploadContext · interface · L24-L30 — interface UploadContext
- uploadAll · function · L36-L56 — async function uploadAll(pending: readonly Pending[], context: UploadContext): Promise<UploadSummary>
