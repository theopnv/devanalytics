import libCoverage from 'istanbul-lib-coverage';
import type { CoverageMap, FileCoverageData } from 'istanbul-lib-coverage';
import type { FileCoverage, Pair } from './metric.ts';
import { sourcePath } from './paths.ts';

interface Location {
  start: { line: number; column: number | null };
  end: { line: number; column: number | null };
}

/**
 * A source map step gives an unmapped end column as Infinity, and JSON writes that as null. Istanbul keys a location
 * by its text, so a map from a JSON file would not match the same statement in memory.
 */
function restoreInfinity(location: Location | undefined): void {
  for (const point of location ? [location.start, location.end] : []) {
    point.column ??= Infinity;
  }
}

function restoreLocations(data: FileCoverageData): void {
  Object.values(data.statementMap).forEach(restoreInfinity);
  Object.values(data.fnMap).forEach((fn) => {
    restoreInfinity(fn.decl);
    restoreInfinity(fn.loc);
  });
  Object.values(data.branchMap).forEach((branch) => {
    restoreInfinity(branch.loc);
    branch.locations.forEach(restoreInfinity);
  });
}

/** Re-keys a map by path relative to the root, and drops the files outside it. */
export function rebase(map: CoverageMap, root: string): CoverageMap {
  const result = libCoverage.createCoverageMap({});
  for (const file of map.files()) {
    const relative = sourcePath(root, file);
    if (relative) {
      const data = { ...map.fileCoverageFor(file).toJSON() as FileCoverageData & { inputSourceMap?: unknown }, path: relative };
      delete data.inputSourceMap;
      restoreLocations(data);
      result.addFileCoverage(data);
    }
  }
  return result;
}

function cloneMap(map: CoverageMap): CoverageMap {
  const result = libCoverage.createCoverageMap({});
  for (const file of map.files()) {
    result.addFileCoverage(structuredClone(map.fileCoverageFor(file).toJSON()) as FileCoverageData);
  }
  return result;
}

export function mergeMaps(...maps: CoverageMap[]): CoverageMap {
  const result = libCoverage.createCoverageMap({});
  for (const map of maps) {
    // The result keeps the file coverage objects it receives and adds hits to them, so it gets copies.
    result.merge(cloneMap(map));
  }
  return result;
}

export function parseIstanbul(text: string, root: string): CoverageMap {
  return rebase(libCoverage.createCoverageMap(JSON.parse(text) as Parameters<typeof libCoverage.createCoverageMap>[0]), root);
}

function pair(summary: { covered: number; total: number }): Pair {
  return [summary.covered, summary.total];
}

export function summarizeMap(map: CoverageMap): FileCoverage[] {
  return map.files().sort().map((file) => {
    const summary = map.fileCoverageFor(file).toSummary();
    return {
      file,
      lines: pair(summary.lines),
      statements: pair(summary.statements),
      functions: pair(summary.functions),
      branches: pair(summary.branches),
    };
  });
}
