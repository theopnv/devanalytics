import { describe, expect, test } from 'vitest';
import { collectorRegistry } from '../action/src/generated/collector-registry.ts';
import { workerRegistry } from '../src/generated/worker-registry.ts';

describe('registries', () => {
  test('list the same metrics', () => {
    expect(workerRegistry.map((entry) => entry.metric.name)).toEqual(collectorRegistry.map((entry) => entry.metric.name));
  });

  test.each(workerRegistry.map((entry) => [entry.metric.name, entry] as const))('%s follows the naming rules', (name, { store }) => {
    expect(name).toMatch(/^[a-z][a-z0-9]*$/);
    expect(store.tables.length).toBeGreaterThan(0);
    for (const table of store.tables) {
      expect(table.startsWith(`${name}_`)).toBe(true);
    }
  });
});
