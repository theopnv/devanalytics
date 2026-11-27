# core/action/inputs.ts

- Env · type · L3-L3 — type Env = Readonly<Record<string, string | undefined>>;
- CoreInputs · interface · L5-L10 — interface CoreInputs
- InputError · class · L12-L14 — class InputError extends Error
- inputVariable · function · L17-L19 — function inputVariable(name: string): string
- readInput · function · L21-L23 — function readInput(env: Env, name: string): string
- parseWorkerUrl · function · L25-L36 — function parseWorkerUrl(value: string): string
- readCoreInputs · function · L39-L53 — function readCoreInputs(env: Env): CoreInputs
- readMetricInputs · function · L56-L65 — function readMetricInputs(specs: readonly InputSpec[], env: Env): Record<string, string>
