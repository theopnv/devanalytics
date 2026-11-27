export function classify(value, strict) {
  if (value === null) {
    return 'none';
  }
  if (typeof value === 'number') {
    if (value < 0 && strict) {
      return 'negative';
    }
    return value % 2 === 0 ? 'even' : 'odd';
  }
  for (const part of String(value)) {
    if (part === ' ' || part === '\t') {
      continue;
    }
    if (part === '!' && strict) {
      return 'shout';
    }
  }
  return 'text';
}

export const double = (value) => value * 2;
