# metrics/ci/run.ts

- Env · type · L3-L3 — type Env = Readonly<Record<string, string | undefined>>;
- RunIds · interface · L5-L8 — interface RunIds
- positive · function · L10-L16 — function positive(name: string, value: string | undefined): number
- readDefaults · function · L19-L25 — async function readDefaults(env: Env): Promise<{ id: string | undefined; attempt: string | undefined }>
- resolveRunIds · function · L28-L33 — async function resolveRunIds(inputs: Readonly<Record<string, string>>, env: Env): Promise<RunIds>
