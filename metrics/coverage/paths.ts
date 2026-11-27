import path from 'node:path';

/**
 * Gives the path of a source file relative to the root with `/` separators, or null for a file outside the root or in `node_modules`.
 * A split module of a bundler names its source with a query, which belongs to no file.
 */
export function sourcePath(root: string, file: string): string | null {
  const [withoutQuery = file] = file.split('?');
  const relative = path.relative(root, path.resolve(root, withoutQuery)).split(path.sep).join('/');
  const segments = relative.split('/');
  if (relative === '' || segments[0] === '..' || path.isAbsolute(relative) || segments.includes('node_modules')) {
    return null;
  }
  return relative;
}
