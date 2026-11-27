import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourcePath } from './paths.ts';

const ROOT = path.join(path.sep, 'repo');
const abs = (relative: string) => path.join(ROOT, relative);

describe('sourcePath', () => {
  it.each([
    ['an absolute path', abs('src/main/a.ts'), 'src/main/a.ts'],
    ['a relative path', 'src/main/a.ts', 'src/main/a.ts'],
    ['a path with ./', './lib/a.ts', 'lib/a.ts'],
    ['a file at the root', abs('index.ts'), 'index.ts'],
    ['a split module with a query', `${abs('src/routes/a.tsx')}?split=component`, 'src/routes/a.tsx'],
  ])('gives the path relative to the root for %s', (_label, file, expected) => {
    // Act
    const result = sourcePath(ROOT, file);

    // Assert
    expect(result).toBe(expected);
  });

  it.each([
    ['a file in a parent folder', abs('../other/a.ts')],
    ['a file in another tree', path.join(path.sep, 'elsewhere', 'a.ts')],
    ['a dependency', abs('node_modules/x/a.ts')],
    ['a nested dependency', abs('packages/x/node_modules/y/a.ts')],
    ['the root itself', ROOT],
  ])('gives null for %s', (_label, file) => {
    // Act
    const result = sourcePath(ROOT, file);

    // Assert
    expect(result).toBeNull();
  });

  it('keeps a folder whose name starts with the same letters as a refused one', () => {
    // Act
    const result = sourcePath(ROOT, abs('node_modules_old/a.ts'));

    // Assert
    expect(result).toBe('node_modules_old/a.ts');
  });
});
