import { classify, double } from './app.js';

export function checks() {
  const results = [classify(null), classify(4, true)];
  return results.map((result) => double(result.length));
}
