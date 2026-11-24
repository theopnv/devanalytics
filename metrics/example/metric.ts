import { ValidationError } from '../../core/contract.ts';
import type { CommitSnapshot, Metric } from '../../core/contract.ts';

export const MAX_ITEMS = 1000;

export interface ExampleItem {
  name: string;
  value: number;
}

export interface ExampleSnapshot extends CommitSnapshot {
  items: ExampleItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseItem(value: unknown, index: number): ExampleItem {
  if (!isRecord(value)) {
    throw new ValidationError(`items[${index}] must be an object`);
  }
  const { name, value: amount } = value;
  if (typeof name !== 'string' || name.length === 0) {
    throw new ValidationError(`items[${index}].name must be a non-empty string`);
  }
  if (!Number.isSafeInteger(amount)) {
    throw new ValidationError(`items[${index}].value must be an integer`);
  }
  return { name, value: amount as number };
}

export const metric: Metric<ExampleSnapshot> = {
  name: 'example',
  key: 'commit',
  parse(body) {
    if (!isRecord(body)) {
      throw new ValidationError('snapshot must be an object');
    }
    const { sha, date, items } = body;
    if (typeof sha !== 'string' || !/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) {
      throw new ValidationError('sha must be a 40 or 64 character hex string');
    }
    if (typeof date !== 'string' || Number.isNaN(Date.parse(date))) {
      throw new ValidationError('date must be an ISO 8601 date');
    }
    if (!Array.isArray(items) || items.length > MAX_ITEMS) {
      throw new ValidationError(`items must be an array of at most ${MAX_ITEMS} items`);
    }
    return { sha, date, items: items.map(parseItem) };
  },
};
