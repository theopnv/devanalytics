import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: './wrangler.jsonc' },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  INGEST_TOKEN: 'test-ingest-token',
                  QUERY_TOKEN: 'test-query-token',
                },
              },
            }),
          ],
          test: {
            name: 'worker',
            setupFiles: ['./test/apply-migrations.ts'],
            include: ['test/**/*.test.ts', '**/*.worker.test.ts'],
            exclude: ['node_modules/**', 'graft/**', '.claude/**', 'examples/**'],
          },
        },
        {
          test: {
            name: 'node',
            environment: 'node',
            include: ['**/*.test.ts'],
            exclude: ['node_modules/**', 'graft/**', '.claude/**', 'examples/**', 'test/**', '**/*.worker.test.ts'],
          },
        },
      ],
    },
  };
});
