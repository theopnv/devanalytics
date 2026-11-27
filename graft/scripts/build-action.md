# scripts/build-action.mts

- describeInput · function · L11-L13 — function describeInput(metric: string, { description, default: fallback }: { description: string; default?: string }): string
- renderMetricInputs · function · L16-L27 — function renderMetricInputs(registry: readonly CollectorEntry[]): string
- replaceMetricInputs · function · L29-L36 — function replaceMetricInputs(actionYml: string, inputs: string): string
- buildAction · function · L39-L63 — async function buildAction(root: string): Promise<void>
