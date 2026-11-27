import { folderPrefixes } from '../../core/worker/folders.ts';
import { COUNTED, TEST_COUNTS } from './metric.ts';
import type { CoverageSnapshot, FileCoverage } from './metric.ts';

export interface FolderCoverage {
  suite: string;
  folder: string;
  /** Eight counts in the order of the table columns: lines, statements, functions, branches, each covered then total. */
  sums: number[];
  file_count: number;
}

/** The eight counts of a file, in the order of the table columns. */
export function fileSums(file: FileCoverage): number[] {
  return COUNTED.flatMap((name) => [...file[name]]);
}

/** One row for each test suite, in the order of the table columns. Empty for a snapshot without test counts. */
export function testRows(snapshot: CoverageSnapshot): (string | number)[][] {
  return Object.entries(snapshot.tests ?? {}).map(([suite, counts]) => [suite, ...TEST_COUNTS.map((name) => counts[name])]);
}

/** Builds one summary for each folder and suite, counting each file in every folder above it, and in the root `.`. */
export function summarizeCoverage(snapshot: CoverageSnapshot): FolderCoverage[] {
  const summaries = new Map<string, FolderCoverage>();
  for (const [suite, files] of Object.entries(snapshot.suites)) {
    for (const file of files) {
      const sums = fileSums(file);
      for (const folder of folderPrefixes(file.file)) {
        const key = `${suite}\u0000${folder}`;
        let summary = summaries.get(key);
        if (!summary) {
          summary = { suite, folder, sums: sums.map(() => 0), file_count: 0 };
          summaries.set(key, summary);
        }
        sums.forEach((sum, index) => {
          summary.sums[index] = (summary.sums[index] ?? 0) + sum;
        });
        summary.file_count += 1;
      }
    }
  }
  return [...summaries.values()];
}
