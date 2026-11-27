import type { Store } from '../../core/contract.ts';
import type { ComplexitySnapshot } from './metric.ts';
import { summarize } from './summary.ts';

const INSERT_FUNCTIONS = `
INSERT INTO complexity_functions (sha, date, file, qualified_name, line, cyclomatic, cognitive, is_test)
SELECT ?1, ?2, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5
FROM json_each(?3)`;

const INSERT_SUMMARY = `
INSERT INTO complexity_folder_summary (sha, date, folder, is_test, function_count, cognitive_sum, cyclomatic_sum,
  cognitive_max, cyclomatic_max, cognitive_above, cyclomatic_above, above_limits)
SELECT ?1, ?2, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4,
  value ->> 5, value ->> 6, value ->> 7, value ->> 8, value ->> 9
FROM json_each(?3)`;

export const store: Store<ComplexitySnapshot> = {
  tables: ['complexity_functions', 'complexity_folder_summary'],
  toRows(snapshot) {
    const limits = { cognitive: snapshot.cognitive_limit, cyclomatic: snapshot.cyclomatic_limit };
    return [
      {
        table: 'complexity_functions',
        insert: INSERT_FUNCTIONS,
        rows: snapshot.functions.map((fn) => [fn.file, fn.qualified_name, fn.line, fn.cyclomatic, fn.cognitive, Number(fn.is_test)]),
      },
      {
        table: 'complexity_folder_summary',
        insert: INSERT_SUMMARY,
        rows: summarize(snapshot.functions, limits).map((s) => [
          s.folder, Number(s.is_test), s.function_count, s.cognitive_sum, s.cyclomatic_sum,
          s.cognitive_max, s.cyclomatic_max, s.cognitive_above, s.cyclomatic_above, s.above_limits,
        ]),
      },
    ];
  },
};
