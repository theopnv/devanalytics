import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface State {
  workerUrl: string;
  uploaded: string[];
}

export interface Cache {
  /** The parsed JSON of a collected snapshot, or undefined when the target is not cached. */
  read(key: string): Promise<unknown>;
  write(key: string, snapshot: unknown): Promise<void>;
  isUploaded(key: string): boolean;
  markUploaded(key: string): Promise<void>;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new Error(`${file} is not valid JSON. Delete it and run the command again.`, { cause: error });
  }
}

/** A write to a temporary file and a rename, so that a stop in the middle cannot leave half a file. */
async function writeJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`);
  await rename(temporary, file);
}

function parseState(value: unknown, file: string, workerUrl: string | undefined): State {
  if (value === undefined) {
    return { workerUrl: workerUrl ?? '', uploaded: [] };
  }
  const { workerUrl: owner, uploaded } = (value ?? {}) as Partial<State>;
  if (typeof owner !== 'string' || !Array.isArray(uploaded)) {
    throw new Error(`${file} does not have the expected fields. Delete it to upload all targets again.`);
  }
  if (workerUrl !== undefined && owner !== workerUrl) {
    throw new Error(`${file} records uploads to ${owner}, and this run uploads to ${workerUrl}. Delete the file to upload all targets again.`);
  }
  return { workerUrl: owner, uploaded: uploaded.map(String) };
}

/**
 * The cache of one metric: `<dir>/<metric>/<key>.json` for each snapshot, and `state.json` for the uploaded keys.
 * A dry run has no Worker, so `workerUrl` can be undefined. Then the cache does not check whom the state belongs to, and does not write it.
 */
export async function openCache(dir: string, metric: string, workerUrl: string | undefined): Promise<Cache> {
  const folder = path.join(dir, metric);
  await mkdir(folder, { recursive: true });
  const stateFile = path.join(folder, 'state.json');
  const state = parseState(await readJson(stateFile), stateFile, workerUrl);
  const uploaded = new Set(state.uploaded);

  return {
    read: (key) => readJson(path.join(folder, `${key}.json`)),
    write: (key, snapshot) => writeJson(path.join(folder, `${key}.json`), snapshot),
    isUploaded: (key) => uploaded.has(key),
    async markUploaded(key) {
      if (workerUrl === undefined) {
        throw new Error('The state cannot record an upload without a Worker URL.');
      }
      uploaded.add(key);
      await writeJson(stateFile, { workerUrl, uploaded: [...uploaded] });
    },
  };
}
