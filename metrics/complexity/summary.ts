import { folderPrefixes } from '../../core/worker/folders.ts';
import type { FunctionRow } from './metric.ts';

export interface Limits {
  cognitive: number;
  cyclomatic: number;
}

export interface FolderSummary {
  folder: string;
  is_test: boolean;
  function_count: number;
  cognitive_sum: number;
  cyclomatic_sum: number;
  cognitive_max: number;
  cyclomatic_max: number;
  cognitive_above: number;
  cyclomatic_above: number;
  above_limits: number;
}

function emptySummary(folder: string, isTest: boolean): FolderSummary {
  return {
    folder,
    is_test: isTest,
    function_count: 0,
    cognitive_sum: 0,
    cyclomatic_sum: 0,
    cognitive_max: 0,
    cyclomatic_max: 0,
    cognitive_above: 0,
    cyclomatic_above: 0,
    above_limits: 0,
  };
}

function addFunction(summary: FolderSummary, fn: FunctionRow, limits: Limits): void {
  const cognitiveAbove = fn.cognitive > limits.cognitive;
  const cyclomaticAbove = fn.cyclomatic > limits.cyclomatic;
  summary.function_count += 1;
  summary.cognitive_sum += fn.cognitive;
  summary.cyclomatic_sum += fn.cyclomatic;
  summary.cognitive_max = Math.max(summary.cognitive_max, fn.cognitive);
  summary.cyclomatic_max = Math.max(summary.cyclomatic_max, fn.cyclomatic);
  summary.cognitive_above += Number(cognitiveAbove);
  summary.cyclomatic_above += Number(cyclomaticAbove);
  summary.above_limits += Number(cognitiveAbove || cyclomaticAbove);
}

/** Builds one summary for each folder and test flag, counting each function in every folder above it, and in the root `.`. */
export function summarize(functions: FunctionRow[], limits: Limits): FolderSummary[] {
  const summaries = new Map<string, FolderSummary>();
  for (const fn of functions) {
    for (const folder of folderPrefixes(fn.file)) {
      const key = `${folder}\u0000${fn.is_test}`;
      let summary = summaries.get(key);
      if (!summary) {
        summary = emptySummary(folder, fn.is_test);
        summaries.set(key, summary);
      }
      addFunction(summary, fn, limits);
    }
  }
  return [...summaries.values()];
}
