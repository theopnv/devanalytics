# core/backfill/args.ts

- UsageError · class · L21-L23 — class UsageError extends Error
- BackfillOptions · interface · L25-L36 — interface BackfillOptions
- parseEvery · function · L38-L44 — function parseEvery(every: string): Selection
- parseRefs · function · L46-L52 — function parseRefs(refs: string): Selection
- parseSelection · function · L54-L66 — function parseSelection(tags: boolean | undefined, every: string | undefined, refs: string | undefined): Selection | undefined
- parseInputs · function · L68-L78 — function parseInputs(pairs: string[]): Record<string, string>
- parseSince · function · L80-L89 — function parseSince(value: string | undefined): Date | undefined
- parseBackfillArgs · function · L91-L129 — function parseBackfillArgs(argv: readonly string[]): BackfillOptions
