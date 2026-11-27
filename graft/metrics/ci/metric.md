# metrics/ci/metric.ts

- CiStep · interface · L15-L21 — interface CiStep
- CiGroup · interface · L24-L27 — interface CiGroup
- CiJob · interface · L29-L39 — interface CiJob
- CiSnapshot · interface · L41-L52 — interface CiSnapshot extends RunSnapshot
- parseStep · function · L54-L62 — function parseStep(value: unknown, field: string): CiStep
- parseGroup · function · L64-L70 — function parseGroup(value: unknown, field: string): CiGroup
- parseRunner · function · L73-L78 — function parseRunner(value: unknown, field: string): string
- parseJob · function · L80-L94 — function parseJob(value: unknown, index: number): CiJob
- parseLabels · function · L96-L109 — function parseLabels(value: unknown): Record<string, string>
- parse · method · L114-L130 — parse(body)
