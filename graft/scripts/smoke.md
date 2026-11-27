# scripts/smoke.mts

- fixtureInputs · function · L16-L24 — async function fixtureInputs(folder: string): Promise<Record<string, string>>
- countRows · function · L26-L37 — async function countRows(worker: DevWorker, metric: string, table: string, key: ReturnType<typeof snapshotKey>): Promise<number>
- readCounts · function · L39-L50 — async function readCounts(worker: DevWorker, entry: WorkerEntry, expected: Map<string, number>, key: ReturnType<typeof snapshotKey>): Promise<Map<string, number>>
- smokeMetric · function · L52-L92 — async function smokeMetric(dev: DevWorker, name: string, { workers, collectors }: Registries): Promise<string>
- main · function · L94-L110 — async function main(names: string[]): Promise<void>
