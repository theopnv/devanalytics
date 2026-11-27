import { expect, test } from 'vitest';
import { expectSha } from './expect.ts';
import { folderPrefixes } from './folders.ts';
import { ValidationError } from '../contract.ts';

test.each([
  ['src/main/a.ts', ['.', 'src', 'src/main']],
  ['src/a.ts', ['.', 'src']],
  ['a.ts', ['.']],
])('folderPrefixes lists the folders of %s from the root', (file, folders) => {
  expect(folderPrefixes(file)).toEqual(folders);
});

test.each(['a'.repeat(40), 'f'.repeat(64)])('expectSha accepts %s', (sha) => {
  expect(expectSha(sha)).toBe(sha);
});

test.each([['a'.repeat(39)], ['a'.repeat(41)], ['A'.repeat(40)], ['main'], [undefined]])('expectSha refuses %s', (sha) => {
  expect(() => expectSha(sha)).toThrow(ValidationError);
});
