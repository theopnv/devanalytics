# metrics/ci/github.ts

- GithubTarget · interface · L3-L7 — interface GithubTarget
- githubTarget · function · L12-L18 — function githubTarget(env: Readonly<Record<string, string | undefined>>, token: string): GithubTarget
- get · function · L20-L32 — async function get(target: GithubTarget, route: string): Promise<unknown>
- fetchJobLog · function · L35-L43 — async function fetchJobLog(target: GithubTarget, jobId: number): Promise<string>
- fetchRun · function · L45-L47 — async function fetchRun(target: GithubTarget, runId: number, attempt: number): Promise<ApiRun>
- fetchJobs · function · L50-L59 — async function fetchJobs(target: GithubTarget, runId: number, attempt: number): Promise<ApiJob[]>
