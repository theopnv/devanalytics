import type { Store } from '../../core/contract.ts';
import type { BundleSizeSnapshot } from './metric.ts';

const INSERT_FILES = `
INSERT INTO bundlesize_files (sha, date, path, bytes, gzip_bytes)
SELECT ?1, ?2, value ->> 0, value ->> 1, value ->> 2
FROM json_each(?3)`;

export const store: Store<BundleSizeSnapshot> = {
  tables: ['bundlesize_files'],
  toRows(snapshot) {
    return [{ table: 'bundlesize_files', insert: INSERT_FILES, rows: snapshot.files.map((file) => [file.path, file.bytes, file.gzip_bytes]) }];
  },
};
