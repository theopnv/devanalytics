import { ValidationError } from '../../core/contract.ts';
import type { CommitSnapshot, Metric } from '../../core/contract.ts';

export const MAX_FILES = 2000;

export interface BundleFile {
  path: string;
  bytes: number;
  gzip_bytes: number;
}

export interface BundleSizeSnapshot extends CommitSnapshot {
  files: BundleFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFile(value: unknown, index: number): BundleFile {
  if (!isRecord(value)) {
    throw new ValidationError(`files[${index}] must be an object`);
  }
  const { path, bytes, gzip_bytes: gzipBytes } = value;
  if (typeof path !== 'string' || path.length === 0) {
    throw new ValidationError(`files[${index}].path must be a non-empty string`);
  }
  if (!Number.isSafeInteger(bytes) || (bytes as number) < 0 || !Number.isSafeInteger(gzipBytes) || (gzipBytes as number) < 0) {
    throw new ValidationError(`files[${index}].bytes and files[${index}].gzip_bytes must be integers of 0 or more`);
  }
  return { path, bytes: bytes as number, gzip_bytes: gzipBytes as number };
}

export const metric: Metric<BundleSizeSnapshot> = {
  name: 'bundlesize',
  key: 'commit',
  parse(body) {
    if (!isRecord(body)) {
      throw new ValidationError('snapshot must be an object');
    }
    const { sha, date, files } = body;
    if (typeof sha !== 'string' || !/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) {
      throw new ValidationError('sha must be a 40 or 64 character hex string');
    }
    if (typeof date !== 'string' || Number.isNaN(Date.parse(date))) {
      throw new ValidationError('date must be an ISO 8601 date');
    }
    if (!Array.isArray(files) || files.length > MAX_FILES) {
      throw new ValidationError(`files must be an array of at most ${MAX_FILES} files`);
    }
    return { sha, date, files: files.map(parseFile) };
  },
};
