# metrics/tests/unzip.ts

- ZipEntry · interface · L14-L20 — interface ZipEntry
- findEnd · function · L22-L30 — function findEnd(zip: Buffer): number
- listEntries · function · L32-L57 — function listEntries(zip: Buffer): ZipEntry[]
- readEntry · function · L59-L72 — function readEntry(zip: Buffer, entry: ZipEntry): Buffer
- safeTarget · function · L75-L78 — function safeTarget(directory: string, name: string): string | null
- unzipInto · function · L81-L94 — async function unzipInto(zip: Buffer, directory: string): Promise<void>
