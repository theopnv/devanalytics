# scripts/sync.mts

- listNames · function · L8-L16 — async function listNames(folder: string, keep: (entry: { name: string; isDirectory(): boolean }) => boolean): Promise<string[]>
- metricNames · function · L18-L31 — async function metricNames(root: string): Promise<string[]>
- workerRegistry · function · L33-L45 — function workerRegistry(names: string[]): string
- collectorRegistry · function · L47-L59 — function collectorRegistry(names: string[]): string
- writeRegistry · function · L61-L64 — async function writeRegistry(file: string, content: string): Promise<void>
- isSql · function · L66-L66 — isSql = (entry: { name: string; isDirectory(): boolean }): boolean
- writeMigrations · function · L68-L84 — async function writeMigrations(root: string, names: string[]): Promise<void>
- sync · function · L87-L93 — async function sync(root: string): Promise<string[]>
