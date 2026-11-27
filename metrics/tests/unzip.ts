import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const MAX_ENTRIES = 5000;
/** An artifact comes from a workflow that a pull request can change, so the unpacked size has a cap. */
export const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

function findEnd(zip: Buffer): number {
  const lowest = Math.max(0, zip.length - 22 - 0xffff);
  for (let position = zip.length - 22; position >= lowest; position -= 1) {
    if (zip.readUInt32LE(position) === END_OF_CENTRAL_DIRECTORY) {
      return position;
    }
  }
  throw new Error('The artifact is not a ZIP file.');
}

export function listEntries(zip: Buffer): ZipEntry[] {
  const end = findEnd(zip);
  const count = zip.readUInt16LE(end + 10);
  if (count > MAX_ENTRIES) {
    throw new Error(`The artifact has ${count} files, which is more than the limit of ${MAX_ENTRIES}.`);
  }
  const entries: ZipEntry[] = [];
  let position = zip.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(position) !== CENTRAL_ENTRY) {
      throw new Error('The ZIP directory of the artifact is not valid.');
    }
    const nameLength = zip.readUInt16LE(position + 28);
    const extraLength = zip.readUInt16LE(position + 30);
    const commentLength = zip.readUInt16LE(position + 32);
    entries.push({
      name: zip.toString('utf8', position + 46, position + 46 + nameLength),
      method: zip.readUInt16LE(position + 10),
      compressedSize: zip.readUInt32LE(position + 20),
      size: zip.readUInt32LE(position + 24),
      offset: zip.readUInt32LE(position + 42),
    });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(zip: Buffer, entry: ZipEntry): Buffer {
  if (zip.readUInt32LE(entry.offset) !== LOCAL_HEADER) {
    throw new Error(`The ZIP entry ${entry.name} is not valid.`);
  }
  const start = entry.offset + 30 + zip.readUInt16LE(entry.offset + 26) + zip.readUInt16LE(entry.offset + 28);
  const data = zip.subarray(start, start + entry.compressedSize);
  if (entry.method === STORED) {
    return data;
  }
  if (entry.method === DEFLATED) {
    return inflateRawSync(data, { maxOutputLength: entry.size });
  }
  throw new Error(`The ZIP entry ${entry.name} uses the compression method ${entry.method}, which is not supported.`);
}

/** Gives the path of an entry inside `directory`, or null for an entry that would leave it. */
export function safeTarget(directory: string, name: string): string | null {
  const target = path.resolve(directory, name);
  return name.length > 0 && !path.isAbsolute(name) && target.startsWith(`${path.resolve(directory)}${path.sep}`) ? target : null;
}

/** Unpacks the files of a ZIP into `directory`. An entry that would leave the folder is refused. */
export async function unzipInto(zip: Buffer, directory: string): Promise<void> {
  const entries = listEntries(zip).filter((entry) => !entry.name.endsWith('/'));
  if (entries.reduce((total, entry) => total + entry.size, 0) > MAX_UNPACKED_BYTES) {
    throw new Error(`The artifact is larger than ${MAX_UNPACKED_BYTES} bytes when it is unpacked.`);
  }
  for (const entry of entries) {
    const target = safeTarget(directory, entry.name);
    if (target === null) {
      throw new Error(`The ZIP entry "${entry.name}" is outside the folder of the artifact.`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, readEntry(zip, entry));
  }
}
