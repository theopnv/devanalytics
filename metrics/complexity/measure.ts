import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@typescript-eslint/typescript-estree';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';
import { findFunctionAt, nameFunctions } from './naming.ts';
import type { FunctionNode } from './naming.ts';
import type { FunctionRow } from './metric.ts';

export interface MeasureOptions {
  /** Globs relative to the root. A file that one of them matches is measured. */
  include: readonly string[];
  /** Globs relative to the root. A file that one of them matches is skipped. */
  exclude: readonly string[];
  /** Globs relative to the root. A file that one of them matches gets `is_test`. */
  testPatterns: readonly string[];
}

export interface Measurement {
  records: FunctionRow[];
  warnings: string[];
}

const COGNITIVE = '@sonarjs/cognitive-complexity';
const CYCLOMATIC = '@sonarjs/cyclomatic-complexity';
const JSX_FILE = /\.(tsx|jsx|js|mjs|cjs)$/;

// Inline config so that the same rules measure every checkout, whatever its own eslint.config says. Disable comments would hide a function from the score.
// ESLint does not count a catch-all pattern such as `**/*` as a match, so the extensions are listed.
const CONFIG: Linter.Config[] = [
  {
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    linterOptions: { noInlineConfig: true },
    languageOptions: { parser: tseslint.parser },
    plugins: { '@sonarjs': sonarjs },
    rules: {
      [COGNITIVE]: ['error', 0],
      [CYCLOMATIC]: ['error', { threshold: 0 }],
    },
  },
];

/** Reads the score from a complexity message. The cyclomatic rule reports JSON, the cognitive rule reports text. */
export function parseScore(ruleId: string, message: string): number | null {
  if (ruleId === CYCLOMATIC) {
    try {
      const { cost } = JSON.parse(message) as { cost?: unknown };
      return typeof cost === 'number' ? cost : null;
    } catch {
      return null;
    }
  }
  if (ruleId === COGNITIVE) {
    const match = /Complexity from (\d+) to/.exec(message);
    return match ? Number(match[1]) : null;
  }
  return null;
}

interface Scores {
  cyclomatic?: number;
  cognitive?: number;
}

function assignScore(scores: Scores, message: Linter.LintMessage): boolean {
  const score = parseScore(message.ruleId ?? '', message.message);
  if (score === null) {
    return false;
  }
  if (message.ruleId === CYCLOMATIC) {
    scores.cyclomatic = score;
  } else {
    scores.cognitive = score;
  }
  return true;
}

/** Lists the files that the include globs match and the exclude globs do not, as sorted paths with `/` separators. */
export async function listFiles(root: string, { include, exclude }: Pick<MeasureOptions, 'include' | 'exclude'>): Promise<string[]> {
  const files = new Set<string>();
  for (const pattern of include) {
    for await (const entry of glob(pattern, { cwd: root, exclude: (name) => name === 'node_modules' })) {
      files.add(entry.split(path.sep).join('/'));
    }
  }
  return [...files].filter((file) => !exclude.some((pattern) => path.posix.matchesGlob(file, pattern))).sort();
}

async function fileRecords(file: string, root: string, options: MeasureOptions, eslint: ESLint, warnings: string[]): Promise<FunctionRow[]> {
  const filePath = path.join(root, file);
  const code = await readFile(filePath, 'utf8');
  const [result] = await eslint.lintText(code, { filePath });
  const fatal = result?.messages.find((message) => message.fatal);
  if (fatal) {
    throw new Error(`${file}:${fatal.line}: ${fatal.message}`);
  }
  const functions = nameFunctions(parse(code, { loc: true, range: true, jsx: JSX_FILE.test(file) }));
  const scores = new Map<FunctionNode, Scores>();
  for (const message of (result?.messages ?? []).filter((m) => m.ruleId === COGNITIVE || m.ruleId === CYCLOMATIC)) {
    const fn = findFunctionAt(functions, { line: message.line, column: message.column - 1 });
    const entry = fn ? (scores.get(fn.node) ?? {}) : {};
    if (!fn || !assignScore(entry, message)) {
      warnings.push(`${file}:${message.line}:${message.column} unmatched ${message.ruleId}: ${message.message}`);
      continue;
    }
    scores.set(fn.node, entry);
  }
  const isTest = options.testPatterns.some((pattern) => path.posix.matchesGlob(file, pattern));
  return functions.flatMap((fn) => {
    const entry = scores.get(fn.node);
    if (entry?.cyclomatic === undefined) {
      warnings.push(`${file}:${fn.start.line} ${fn.qualifiedName} has no cyclomatic score`);
      return [];
    }
    return [{
      file,
      qualified_name: fn.qualifiedName,
      line: fn.start.line,
      cyclomatic: entry.cyclomatic,
      cognitive: entry.cognitive ?? 0,
      is_test: isTest,
    }];
  });
}

/** Measures every function in the files of `root` that the options select. The cognitive rule skips functions that score 0. */
export async function measure(root: string, options: MeasureOptions): Promise<Measurement> {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: CONFIG });
  const warnings: string[] = [];
  const records: FunctionRow[] = [];
  for (const file of await listFiles(root, options)) {
    records.push(...await fileRecords(file, root, options, eslint, warnings));
  }
  records.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.qualified_name.localeCompare(b.qualified_name));
  return { records, warnings };
}
