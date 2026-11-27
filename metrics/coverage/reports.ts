import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mergeMaps, parseIstanbul, summarizeMap } from './istanbul.ts';
import { mergeLcov, parseLcov, summarizeLcov } from './lcov.ts';
import type { LcovFiles } from './lcov.ts';
import { MAX_SUITES, SUITE_NAME, TOTAL } from './metric.ts';
import type { FileCoverage, TestCounts } from './metric.ts';
import { countTestResults } from './testresults.ts';

export interface NamedPath {
  name: string;
  file: string;
}

type Report = { name: string; format: 'istanbul'; map: ReturnType<typeof parseIstanbul> } | { name: string; format: 'lcov'; files: LcovFiles };

/** Reads the lines of an input such as `reports`. Each line is `suite=path`. */
export function parseNamedPaths(input: string, value: string | undefined): NamedPath[] {
  const entries = (value ?? '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    const name = line.slice(0, separator).trim();
    const file = line.slice(separator + 1).trim();
    if (separator === -1 || !file) {
      throw new Error(`${input}: "${line}" must look like suite=path, for example unit=coverage/lcov.info.`);
    }
    if (!SUITE_NAME.test(name)) {
      throw new Error(`${input}: "${name}" is not a suite name. Use letters, digits, ".", "_" and "-", and at most 64 characters.`);
    }
    return { name, file };
  });
  const names = entries.map((entry) => entry.name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) {
    throw new Error(`${input}: the suite "${duplicate}" is named twice.`);
  }
  if (entries.length > MAX_SUITES) {
    throw new Error(`${input}: ${entries.length} suites is more than the limit of ${MAX_SUITES}.`);
  }
  return entries;
}

async function readText(root: string, input: string, entry: NamedPath): Promise<string> {
  try {
    return await readFile(path.resolve(root, entry.file), 'utf8');
  } catch (error) {
    throw new Error(`${input}: cannot read ${entry.file} for the suite "${entry.name}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** A JSON file is an Istanbul coverage-final.json. Anything else is read as lcov. */
async function loadReport(root: string, entry: NamedPath): Promise<Report> {
  const text = await readText(root, 'reports', entry);
  try {
    return text.trimStart().startsWith('{')
      ? { name: entry.name, format: 'istanbul', map: parseIstanbul(text, root) }
      : { name: entry.name, format: 'lcov', files: parseLcov(text, root) };
  } catch (error) {
    throw new Error(`reports: cannot read ${entry.file} for the suite "${entry.name}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function summarizeReport(report: Report): FileCoverage[] {
  return report.format === 'istanbul' ? summarizeMap(report.map) : summarizeLcov(report.files);
}

function summarizeTotal(reports: readonly Report[]): FileCoverage[] {
  const istanbul = reports.filter((report) => report.format === 'istanbul');
  const lcov = reports.filter((report) => report.format === 'lcov');
  if (istanbul.length > 0 && lcov.length > 0) {
    throw new Error(`reports: the total suite cannot merge Istanbul JSON and lcov reports. Use one format for all reports.`);
  }
  return istanbul.length > 0
    ? summarizeMap(mergeMaps(...istanbul.map(({ map }) => map)))
    : summarizeLcov(mergeLcov(...lcov.map(({ files }) => files)));
}

/**
 * One report gives the `total` suite alone. Two or more give one suite each, and `total` is their union.
 * The paths of the files are relative to `root`.
 */
export async function loadSuites(root: string, entries: readonly NamedPath[]): Promise<Record<string, FileCoverage[]>> {
  const [first, ...rest] = await Promise.all(entries.map((entry) => loadReport(root, entry)));
  if (!first) {
    throw new Error('reports: give at least one report, for example unit=coverage/lcov.info.');
  }
  if (rest.length === 0) {
    return { [TOTAL]: summarizeReport(first) };
  }
  const reports = [first, ...rest];
  if (reports.some((report) => report.name === TOTAL)) {
    throw new Error(`reports: "${TOTAL}" is the name of the union of the reports. Choose another suite name.`);
  }
  return { ...Object.fromEntries(reports.map((report) => [report.name, summarizeReport(report)])), [TOTAL]: summarizeTotal(reports) };
}

export async function loadTestCounts(root: string, entries: readonly NamedPath[]): Promise<Record<string, TestCounts>> {
  const counts = await Promise.all(entries.map(async (entry) => {
    try {
      return [entry.name, countTestResults(await readText(root, 'test-results', entry), entry.file)] as const;
    } catch (error) {
      throw new Error(`test-results: cannot read ${entry.file} for the suite "${entry.name}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }));
  return Object.fromEntries(counts);
}
