import type { Store } from '../../core/contract.ts';
import type { ExampleSnapshot } from './metric.ts';

const INSERT_ITEMS = `
INSERT INTO example_items (sha, date, name, value)
SELECT ?1, ?2, value ->> 0, value ->> 1
FROM json_each(?3)`;

export const store: Store<ExampleSnapshot> = {
  tables: ['example_items'],
  toRows(snapshot) {
    return [{ table: 'example_items', insert: INSERT_ITEMS, rows: snapshot.items.map((item) => [item.name, item.value]) }];
  },
};
