import type { Collector } from '../../core/contract.ts';
import { headCommit } from '../../core/git.ts';
import { measure } from './measure.ts';
import type { ComplexitySnapshot } from './metric.ts';

export const DEFAULTS = {
  include: 'src/**/*.{ts,tsx,js,jsx}',
  testPattern: '**/*.test.*',
  cognitiveLimit: '15',
  cyclomaticLimit: '10',
} as const;

export function readLines(value: string | undefined): string[] {
  return (value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}

export function readLimit(name: string, value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a whole number of 0 or more, and it is "${value}".`);
  }
  return Number(value);
}

export const collector: Collector<ComplexitySnapshot> = {
  inputs: [
    { name: 'include', description: 'Globs of the files to measure, one on each line.', default: DEFAULTS.include },
    { name: 'exclude', description: 'Globs of the files to skip, one on each line. The node_modules folders are always skipped.' },
    { name: 'test-pattern', description: 'Globs of the test files, one on each line. The summaries keep test functions apart.', default: DEFAULTS.testPattern },
    { name: 'cognitive-limit', description: 'A function above this cognitive complexity counts as above the limit.', default: DEFAULTS.cognitiveLimit },
    { name: 'cyclomatic-limit', description: 'A function above this cyclomatic complexity counts as above the limit.', default: DEFAULTS.cyclomaticLimit },
  ],
  backfill: 'commits',
  async collect({ inputs, cwd }) {
    const cognitiveLimit = readLimit('cognitive-limit', inputs['cognitive-limit'] ?? DEFAULTS.cognitiveLimit);
    const cyclomaticLimit = readLimit('cyclomatic-limit', inputs['cyclomatic-limit'] ?? DEFAULTS.cyclomaticLimit);
    const { records, warnings } = await measure(cwd, {
      include: readLines(inputs['include'] ?? DEFAULTS.include),
      exclude: readLines(inputs['exclude']),
      testPatterns: readLines(inputs['test-pattern'] ?? DEFAULTS.testPattern),
    });
    for (const warning of warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }
    return {
      ...headCommit(cwd),
      cognitive_limit: cognitiveLimit,
      cyclomatic_limit: cyclomaticLimit,
      functions: records,
    };
  },
};
