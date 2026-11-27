# core/worker/expect.ts

- expectObject · function · L3-L8 — function expectObject(value: unknown, field: string): Record<string, unknown>
- expectText · function · L10-L15 — function expectText(value: unknown, field: string): string
- expectInteger · function · L18-L23 — function expectInteger(value: unknown, field: string): number
- expectBoolean · function · L25-L30 — function expectBoolean(value: unknown, field: string): boolean
- expectNullableInteger · function · L32-L34 — function expectNullableInteger(value: unknown, field: string): number | null
- expectOneOf · function · L36-L41 — function expectOneOf<T extends string>(value: unknown, field: string, options: readonly T[]): T
- expectList · function · L43-L48 — function expectList(value: unknown, field: string, maxLength: number): unknown[]
- expectSha · function · L50-L55 — function expectSha(value: unknown): string
- expectDate · function · L58-L65 — function expectDate(value: unknown): string
