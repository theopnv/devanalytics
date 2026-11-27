# metrics/tests/artifacts.ts

- Env · type · L5-L5 — type Env = Readonly<Record<string, string | undefined>>;
- ApiArtifact · interface · L7-L11 — interface ApiArtifact
- headers · function · L16-L18 — function headers(token: string): Record<string, string>
- folderName · function · L21-L23 — function folderName(name: string): string | null
- listArtifacts · function · L25-L40 — async function listArtifacts(base: string, repository: string, runId: number, token: string): Promise<ApiArtifact[]>
- downloadArtifacts · function · L46-L71 — async function downloadArtifacts(env: Env, token: string, runId: number, directory: string, warn: (message: string) => void): Promise<number>
