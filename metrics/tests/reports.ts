import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ExceptionRow, SuiteRow } from './metric.ts';
import { summarizeReport } from './report.ts';

export interface NamedPath {
  name: string;
  file: string;
}

export interface LoadedReports {
  suites: SuiteRow[];
  exceptions: ExceptionRow[];
}

/** A Playwright report of a full suite is a few megabytes, and a pull request controls the file. */
const MAX_REPORT_BYTES = 50 * 1024 * 1024;

/** Reads the lines of the `reports` input. Each line is `suite=path`. */
export function parseNamedPaths(value: string | undefined): NamedPath[] {
  const entries = (value ?? '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    const name = line.slice(0, separator).trim();
    const file = line.slice(separator + 1).trim();
    if (separator === -1 || !name || !file) {
      throw new Error(`reports: "${line}" must look like suite=path, for example unit=unit.json.`);
    }
    return { name, file };
  });
  const names = entries.map((entry) => entry.name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) {
    throw new Error(`reports: the suite "${duplicate}" is named twice.`);
  }
  return entries;
}

async function readReport(file: string): Promise<string | null> {
  const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (!info?.isFile()) {
    return null;
  }
  if (info.size > MAX_REPORT_BYTES) {
    throw new Error('The report is too large.');
  }
  return readFile(file, 'utf8');
}

/**
 * Reads the artifact folder `root`, which has one subfolder for each runner. Each `suite=path` entry names a report inside a runner folder.
 * A runner that has no such file did not run the suite. A report that cannot be read gives a warning and no result,
 * so one broken report never stops the ingest of the others.
 */
export async function loadReports(root: string, entries: readonly NamedPath[], warn: (message: string) => void, workspace?: string): Promise<LoadedReports> {
  const runners = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const loaded: LoadedReports = { suites: [], exceptions: [] };
  for (const runner of runners) {
    for (const { name: suite, file } of entries) {
      try {
        const text = await readReport(path.join(root, runner, file));
        if (text === null) {
          continue;
        }
        const { exceptions, ...counts } = summarizeReport(text, workspace);
        loaded.suites.push({ suite, runner, ...counts });
        loaded.exceptions.push(...exceptions.map((exception) => ({ suite, runner, ...exception })));
      } catch (error) {
        warn(`Skipped the ${suite} report of ${runner}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return loaded;
}
