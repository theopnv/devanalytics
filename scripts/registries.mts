import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CollectorEntry, WorkerEntry } from '../core/contract.ts';

export interface Registries {
  workers: readonly WorkerEntry[];
  collectors: readonly CollectorEntry[];
}

/** Loads the generated registries when it is called, so it sees the files that `sync` wrote just before. */
export async function loadRegistries(root: string): Promise<Registries> {
  const toUrl = (file: string): string => pathToFileURL(path.join(root, file)).href;
  const { workerRegistry } = await import(toUrl('src/generated/worker-registry.ts')) as { workerRegistry: readonly WorkerEntry[] };
  const { collectorRegistry } = await import(toUrl('action/src/generated/collector-registry.ts')) as { collectorRegistry: readonly CollectorEntry[] };
  return { workers: workerRegistry, collectors: collectorRegistry };
}
