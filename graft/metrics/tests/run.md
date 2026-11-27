# metrics/tests/run.ts

- RunInfo · interface · L3-L8 — interface RunInfo
- Defaults · interface · L10-L14 — interface Defaults
- Env · type · L16-L16 — type Env = Readonly<Record<string, string | undefined>>;
- positive · function · L18-L24 — function positive(name: string, value: string | undefined): number
- readDefaults · function · L27-L39 — async function readDefaults(env: Env): Promise<Defaults>
- fetchStart · function · L41-L56 — async function fetchStart(env: Env, token: string, id: number, attempt: number): Promise<string>
- resolveStart · function · L58-L66 — function resolveStart(inputs: Readonly<Record<string, string>>, env: Env, defaults: Defaults, id: number, attempt: number): Promise<string | undefined> | string | undefined
- resolveRun · function · L72-L81 — async function resolveRun(inputs: Readonly<Record<string, string>>, env: Env): Promise<RunInfo>
