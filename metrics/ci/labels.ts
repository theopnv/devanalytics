import { LABEL_KEY, MAX_LABELS, MAX_LABEL_VALUE } from './metric.ts';

/** Reads the `labels` input. Each line is `key=value`. */
export function parseLabels(value: string | undefined): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const line of (value ?? '').split('\n').map((entry) => entry.trim()).filter(Boolean)) {
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    const text = line.slice(separator + 1).trim();
    if (separator === -1 || !LABEL_KEY.test(key)) {
      throw new Error(`labels: "${line}" must look like key=value. The key uses letters, digits, ".", "_" and "-", and has at most 64 characters.`);
    }
    if (text.length > MAX_LABEL_VALUE) {
      throw new Error(`labels: the value of "${key}" is longer than ${MAX_LABEL_VALUE} characters.`);
    }
    if (key in labels) {
      throw new Error(`labels: the key "${key}" is set twice.`);
    }
    labels[key] = text;
  }
  if (Object.keys(labels).length > MAX_LABELS) {
    throw new Error(`labels: ${Object.keys(labels).length} labels is more than the limit of ${MAX_LABELS}.`);
  }
  return labels;
}
