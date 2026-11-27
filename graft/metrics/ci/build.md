# metrics/ci/build.ts

- ApiRun · interface · L5-L16 — interface ApiRun
- ApiStep · interface · L18-L24 — interface ApiStep
- ApiJob · interface · L26-L35 — interface ApiJob
- Os · type · L37-L37 — type Os = (typeof OSES)[number];
- secondsBetween · function · L40-L46 — function secondsBetween(from: string | null | undefined, to: string | null | undefined): number | null
- osOf · function · L48-L56 — function osOf(runner: string): Os
- snapshotJob · function · L58-L77 — function snapshotJob(job: ApiJob, groups: readonly LogGroup[]): CiJob
- buildSnapshot · function · L80-L100 — function buildSnapshot( run: ApiRun, apiJobs: ApiJob[], groups: ReadonlyMap<number, readonly LogGroup[]> = new Map(), labels: Record<string, string> = {}, ): CiSnapshot
