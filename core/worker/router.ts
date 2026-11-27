import { ValidationError } from '../contract.ts';
import type { WorkerEntry } from '../contract.ts';
import { hasToken } from './auth.ts';
import { BudgetError, isBackfill, limitsFrom, readUsage, utcDay } from './budget.ts';
import { ingest } from './ingest.ts';
import { parseQuery, QueryError, runQuery } from './query.ts';

const BADGE_CACHE_SECONDS = 3600;

const json = (body: unknown, status = 200) => Response.json(body, { status });

type Handler = (request: Request, env: Env) => Promise<Response>;

interface Route {
  method: 'GET' | 'POST';
  handle: Handler;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('body must be JSON');
  }
}

function ingestRoute(entry: WorkerEntry): Handler {
  return async (request, env) => {
    if (!(await hasToken(request, env.INGEST_TOKEN))) {
      return json({ error: 'unauthorized' }, 401);
    }
    const options = { backfill: isBackfill(request), limits: limitsFrom(env.DAILY_WRITE_LIMIT), now: new Date() };
    return json(await ingest(env.DB, entry, await readJson(request), options));
  };
}

function queryRoute(entry: WorkerEntry, registryTables: readonly string[]): Handler {
  return async (request, env) => {
    if (!(await hasToken(request, env.QUERY_TOKEN))) {
      return json({ error: 'unauthorized' }, 401);
    }
    return json(await runQuery(env.DB, parseQuery(await readJson(request), entry.store.tables, registryTables)));
  };
}

/** Public and read-only: shields.io fetches it without a token. The store reads the request parameters and runs one fixed query. */
function badgeRoute(badge: NonNullable<WorkerEntry['store']['badge']>): Handler {
  return async (request, env) => {
    const endpoint = await badge(env.DB, new URL(request.url).searchParams);
    return Response.json({ ...endpoint, cacheSeconds: BADGE_CACHE_SECONDS }, {
      headers: { 'Cache-Control': `public, max-age=${BADGE_CACHE_SECONDS}` },
    });
  };
}

const usageRoute: Handler = async (request, env) => {
  if (!(await hasToken(request, env.QUERY_TOKEN))) {
    return json({ error: 'unauthorized' }, 401);
  }
  const day = utcDay(new Date());
  const result = await readUsage(env.DB, day).first<{ n: number }>();
  return json({ day, rowsWritten: result?.n ?? 0, ...limitsFrom(env.DAILY_WRITE_LIMIT) });
};

function metricRoutes(entry: WorkerEntry, registryTables: readonly string[]): [string, Route][] {
  const prefix = `/v1/${entry.metric.name}`;
  const routes: [string, Route][] = [
    [`${prefix}/ingest`, { method: 'POST', handle: ingestRoute(entry) }],
    [`${prefix}/query`, { method: 'POST', handle: queryRoute(entry, registryTables) }],
  ];
  if (entry.store.badge) {
    routes.push([`${prefix}/badge`, { method: 'GET', handle: badgeRoute(entry.store.badge.bind(entry.store)) }]);
  }
  return routes;
}

function errorResponse(error: unknown): Response {
  if (error instanceof BudgetError) {
    const { message: reason, used, cost, ceiling, retryAfter } = error;
    return Response.json({ error: reason, rowsWritten: used, cost, limit: ceiling }, {
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
    });
  }
  if (error instanceof ValidationError || error instanceof QueryError) {
    return json({ error: error.message }, 400);
  }
  // D1 errors carry the SQLite message, such as a failed CHECK or a syntax error.
  const message = error instanceof Error ? error.message : String(error);
  return json({ error: message }, 422);
}

/** Builds the Worker from the registry that `npm run sync` generates. */
export function createWorker(registry: readonly WorkerEntry[]) {
  const registryTables = registry.flatMap((entry) => entry.store.tables);
  const routes = new Map<string, Route>([
    ['/v1/usage', { method: 'GET', handle: usageRoute }],
    ...registry.flatMap((entry) => metricRoutes(entry, registryTables)),
  ]);

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const route = routes.get(new URL(request.url).pathname);
      if (!route) {
        return json({ error: 'not found' }, 404);
      }
      if (request.method !== route.method) {
        return json({ error: 'method not allowed' }, 405);
      }
      try {
        return await route.handle(request, env);
      } catch (error) {
        return errorResponse(error);
      }
    },
  } satisfies ExportedHandler<Env>;
}
