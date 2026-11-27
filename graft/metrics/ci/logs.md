# metrics/ci/logs.ts

- LogReader · type · L5-L5 — type LogReader = (target: GithubTarget, jobId: number) => Promise<string>;
- loadLogGroups · function · L11-L26 — async function loadLogGroups( target: GithubTarget, jobs: ApiJob[], warn: (message: string) => void, readLog: LogReader = fetchJobLog, ): Promise<Map<number, LogGroup[]>>
