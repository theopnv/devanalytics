import type { CommitSnapshot, Metric } from '../../core/contract.ts';
import { expectBoolean, expectDate, expectInteger, expectList, expectObject, expectSha, expectText } from '../../core/worker/expect.ts';

export const MAX_FUNCTIONS = 50_000;

export interface FunctionRow {
  file: string;
  qualified_name: string;
  line: number;
  cyclomatic: number;
  cognitive: number;
  is_test: boolean;
}

export interface ComplexitySnapshot extends CommitSnapshot {
  /** The limits that the collector used. The store counts the functions above them. */
  cognitive_limit: number;
  cyclomatic_limit: number;
  functions: FunctionRow[];
}

function parseFunction(value: unknown, index: number): FunctionRow {
  const field = `functions[${index}]`;
  const fn = expectObject(value, field);
  return {
    file: expectText(fn['file'], `${field}.file`),
    qualified_name: expectText(fn['qualified_name'], `${field}.qualified_name`),
    line: expectInteger(fn['line'], `${field}.line`),
    cyclomatic: expectInteger(fn['cyclomatic'], `${field}.cyclomatic`),
    cognitive: expectInteger(fn['cognitive'], `${field}.cognitive`),
    is_test: expectBoolean(fn['is_test'], `${field}.is_test`),
  };
}

export const metric: Metric<ComplexitySnapshot> = {
  name: 'complexity',
  key: 'commit',
  parse(body) {
    const snapshot = expectObject(body, 'snapshot');
    return {
      sha: expectSha(snapshot['sha']),
      date: expectDate(snapshot['date']),
      cognitive_limit: expectInteger(snapshot['cognitive_limit'], 'cognitive_limit'),
      cyclomatic_limit: expectInteger(snapshot['cyclomatic_limit'], 'cyclomatic_limit'),
      functions: expectList(snapshot['functions'], 'functions', MAX_FUNCTIONS).map(parseFunction),
    };
  },
};
