import { ValidationError } from '../../core/contract.ts';
import type { ShieldsEndpoint, Store } from '../../core/contract.ts';
import { SUITE_NAME, TOTAL } from './metric.ts';
import type { CoverageSnapshot } from './metric.ts';
import { fileSums, summarizeCoverage, testRows } from './summary.ts';

const INSERT_FILES = `
INSERT INTO coverage_files (sha, date, suite, file, lines_covered, lines_total, statements_covered, statements_total,
  functions_covered, functions_total, branches_covered, branches_total)
SELECT ?1, ?2, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5,
  value ->> 6, value ->> 7, value ->> 8, value ->> 9
FROM json_each(?3)`;

const INSERT_SUMMARY = `
INSERT INTO coverage_folder_summary (sha, date, suite, folder, lines_covered, lines_total, statements_covered, statements_total,
  functions_covered, functions_total, branches_covered, branches_total, file_count)
SELECT ?1, ?2, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5,
  value ->> 6, value ->> 7, value ->> 8, value ->> 9, value ->> 10
FROM json_each(?3)`;

const INSERT_TESTS = `
INSERT INTO coverage_tests (sha, date, suite, files, tests, passed, failed, skipped)
SELECT ?1, ?2, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5
FROM json_each(?3)`;

const LATEST = `
SELECT lines_covered, lines_total FROM coverage_folder_summary
WHERE folder = ?1 AND suite = ?2
ORDER BY date DESC LIMIT 1`;

const MAX_FOLDER_LENGTH = 1000;

/** The same bands as the Stryker mutation score badge, so both badges read alike. */
export function badgeColor(percent: number): string {
  if (percent >= 80) {
    return 'brightgreen';
  }
  return percent >= 60 ? 'orange' : 'red';
}

export function coverageBadge(row: { lines_covered: number; lines_total: number } | null): ShieldsEndpoint {
  if (!row || row.lines_total === 0) {
    return { schemaVersion: 1, label: 'coverage', message: 'unknown', color: 'lightgrey' };
  }
  const percent = Math.round((1000 * row.lines_covered) / row.lines_total) / 10;
  return { schemaVersion: 1, label: 'coverage', message: `${percent.toFixed(1)}%`, color: badgeColor(percent) };
}

export function readBadgeParams(params: URLSearchParams): { suite: string; folder: string } {
  const suite = params.get('suite') ?? TOTAL;
  const folder = params.get('folder') ?? '.';
  if (!SUITE_NAME.test(suite)) {
    throw new ValidationError('suite must be a suite name');
  }
  // The folder is bound as a parameter, so any text is safe. The checks only refuse input that cannot be a folder.
  if (folder.length === 0 || folder.length > MAX_FOLDER_LENGTH || [...folder].some((char) => char.charCodeAt(0) < 32)) {
    throw new ValidationError(`folder must be "." or a folder path of at most ${MAX_FOLDER_LENGTH} characters`);
  }
  return { suite, folder };
}

export const store: Store<CoverageSnapshot> = {
  tables: ['coverage_files', 'coverage_folder_summary', 'coverage_tests'],
  toRows(snapshot) {
    return [
      {
        table: 'coverage_files',
        insert: INSERT_FILES,
        rows: Object.entries(snapshot.suites).flatMap(([suite, files]) => files.map((file) => [suite, file.file, ...fileSums(file)])),
      },
      {
        table: 'coverage_folder_summary',
        insert: INSERT_SUMMARY,
        rows: summarizeCoverage(snapshot).map((s) => [s.suite, s.folder, ...s.sums, s.file_count]),
      },
      { table: 'coverage_tests', insert: INSERT_TESTS, rows: testRows(snapshot) },
    ];
  },
  /** The query is fixed. Only the two bound parameters come from the request. */
  async badge(db, params) {
    const { suite, folder } = readBadgeParams(params);
    return coverageBadge(await db.prepare(LATEST).bind(folder, suite).first<{ lines_covered: number; lines_total: number }>());
  },
};
