# metrics/complexity/measure.ts

- MeasureOptions · interface · L12-L19 — interface MeasureOptions
- Measurement · interface · L21-L24 — interface Measurement
- parseScore · function · L46-L60 — function parseScore(ruleId: string, message: string): number | null
- Scores · interface · L62-L65 — interface Scores
- assignScore · function · L67-L78 — function assignScore(scores: Scores, message: Linter.LintMessage): boolean
- listFiles · function · L81-L89 — async function listFiles(root: string, { include, exclude }: Pick<MeasureOptions, 'include' | 'exclude'>): Promise<string[]>
- fileRecords · function · L91-L126 — async function fileRecords(file: string, root: string, options: MeasureOptions, eslint: ESLint, warnings: string[]): Promise<FunctionRow[]>
- measure · function · L129-L138 — async function measure(root: string, options: MeasureOptions): Promise<Measurement>
