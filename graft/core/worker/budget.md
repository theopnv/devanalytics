# core/worker/budget.ts

- Limits · interface · L9-L14 — interface Limits
- BudgetError · class · L17-L32 — class BudgetError extends Error
- constructor · method · L25-L31 — constructor(message: string, used: number, cost: number, ceiling: number, retryAfter: number)
- limitsFrom · function · L34-L38 — function limitsFrom(dailyLimit: string | undefined): Limits
- isBackfill · function · L40-L42 — function isBackfill(request: Request): boolean
- utcDay · function · L44-L46 — function utcDay(now: Date): string
- secondsUntilUtcMidnight · function · L48-L51 — function secondsUntilUtcMidnight(now: Date): number
- readUsage · function · L53-L55 — function readUsage(db: D1Database, day: string): D1PreparedStatement
- recordUsage · function · L57-L61 — function recordUsage(db: D1Database, day: string, rows: number): D1PreparedStatement
- estimateCost · function · L64-L66 — function estimateCost(inserts: readonly TableRows[], replaced = 0): number
- checkBudget · function · L69-L77 — function checkBudget(used: number, cost: number, ceiling: number, now: Date): void
