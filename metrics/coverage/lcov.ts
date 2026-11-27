import type { FileCoverage, Pair } from './metric.ts';
import { sourcePath } from './paths.ts';

/** The hits of one file, keyed so that two reports of the same file add up. */
export interface LcovFile {
  lines: Map<number, number>;
  functions: Map<string, number>;
  branches: Map<string, number>;
}

export type LcovFiles = Map<string, LcovFile>;

function emptyFile(): LcovFile {
  return { lines: new Map(), functions: new Map(), branches: new Map() };
}

function addHits<K>(hits: Map<K, number>, key: K, count: number): void {
  hits.set(key, (hits.get(key) ?? 0) + count);
}

function toCount(text: string | undefined): number {
  const count = Number(text);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function afterComma(value: string): [string, string] {
  const index = value.indexOf(',');
  return index === -1 ? [value, ''] : [value.slice(0, index), value.slice(index + 1)];
}

/** `FN:<line>,<name>`, or `FN:<line>,<end line>,<name>` in lcov 2. A name with a comma is not supported. */
function functionName(value: string): string {
  const parts = value.split(',');
  return parts.length >= 3 && /^\d+$/.test(parts[1] ?? '') ? parts.slice(2).join(',') : parts.slice(1).join(',');
}

function readRecord(file: LcovFile, tag: string, value: string): void {
  if (tag === 'DA') {
    const [line, rest] = afterComma(value);
    addHits(file.lines, Number(line), toCount(rest.split(',')[0]));
  } else if (tag === 'FN') {
    const name = functionName(value);
    file.functions.set(name, file.functions.get(name) ?? 0);
  } else if (tag === 'FNDA') {
    const [hits, name] = afterComma(value);
    addHits(file.functions, name, toCount(hits));
  } else if (tag === 'BRDA') {
    const [line, block, branch, taken] = value.split(',');
    addHits(file.branches, `${line},${block},${branch}`, toCount(taken));
  }
}

/** Reads the detail records of an lcov file. The summary records (LF, LH, FNF, FNH, BRF, BRH) are ignored, because a merge needs the detail. */
export function parseLcov(text: string, root: string): LcovFiles {
  const files: LcovFiles = new Map();
  let current: LcovFile | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const separator = line.indexOf(':');
    const tag = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1);
    if (tag === 'SF') {
      const relative = sourcePath(root, value);
      current = relative === null ? null : (files.get(relative) ?? files.set(relative, emptyFile()).get(relative) ?? null);
    } else if (tag === 'end_of_record') {
      current = null;
    } else if (current) {
      readRecord(current, tag, value);
    }
  }
  return files;
}

export function mergeLcov(...reports: LcovFiles[]): LcovFiles {
  const result: LcovFiles = new Map();
  for (const report of reports) {
    for (const [name, file] of report) {
      const target = result.get(name) ?? result.set(name, emptyFile()).get(name);
      if (!target) {
        continue;
      }
      file.lines.forEach((hits, key) => addHits(target.lines, key, hits));
      file.functions.forEach((hits, key) => addHits(target.functions, key, hits));
      file.branches.forEach((hits, key) => addHits(target.branches, key, hits));
    }
  }
  return result;
}

function pair(hits: Map<unknown, number>): Pair {
  return [[...hits.values()].filter((count) => count > 0).length, hits.size];
}

/** The lcov format has no statements, so they repeat the lines. */
export function summarizeLcov(files: LcovFiles): FileCoverage[] {
  return [...files].sort(([a], [b]) => a.localeCompare(b)).map(([file, hits]) => {
    const lines = pair(hits.lines);
    return { file, lines, statements: lines, functions: pair(hits.functions), branches: pair(hits.branches) };
  });
}
