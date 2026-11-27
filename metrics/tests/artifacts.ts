import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { unzipInto } from './unzip.ts';

type Env = Readonly<Record<string, string | undefined>>;

interface ApiArtifact {
  id: number;
  name: string;
  expired: boolean;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

function headers(token: string): Record<string, string> {
  return { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

/** An artifact name becomes a folder name, so it cannot hold a separator or be `.` or `..`. */
export function folderName(name: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(name) && !name.includes('..') ? name : null;
}

async function listArtifacts(base: string, repository: string, runId: number, token: string): Promise<ApiArtifact[]> {
  const artifacts: ApiArtifact[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const route = `/repos/${repository}/actions/runs/${runId}/artifacts?per_page=${PAGE_SIZE}&page=${page}`;
    const response = await fetch(`${base}${route}`, { headers: headers(token) });
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status} for ${route}: ${(await response.text()).slice(0, 300)}`);
    }
    const body = await response.json() as { artifacts?: ApiArtifact[] };
    artifacts.push(...body.artifacts ?? []);
    if ((body.artifacts ?? []).length < PAGE_SIZE) {
      break;
    }
  }
  return artifacts;
}

/**
 * Downloads the artifacts of a run into `directory`, one folder for each artifact, like `actions/download-artifact` does.
 * An expired artifact or an artifact with an unsafe name is skipped with a warning. Returns the number of folders written.
 */
export async function downloadArtifacts(env: Env, token: string, runId: number, directory: string, warn: (message: string) => void): Promise<number> {
  const repository = env['GITHUB_REPOSITORY'];
  if (!repository) {
    throw new Error('Set GITHUB_REPOSITORY to download the artifacts of a run.');
  }
  const base = (env['GITHUB_API_URL'] || 'https://api.github.com').replace(/\/+$/, '');
  let written = 0;
  for (const artifact of await listArtifacts(base, repository, runId, token)) {
    const folder = folderName(artifact.name);
    if (artifact.expired || folder === null) {
      warn(`Skipped the artifact "${artifact.name}": ${artifact.expired ? 'it expired' : 'its name cannot be a folder name'}.`);
      continue;
    }
    // GitHub answers with a redirect to a signed address, and fetch does not send the token to another host.
    const response = await fetch(`${base}/repos/${repository}/actions/artifacts/${artifact.id}/zip`, { headers: headers(token) });
    if (!response.ok) {
      warn(`Skipped the artifact "${artifact.name}": GitHub answered ${response.status}.`);
      continue;
    }
    const target = path.join(directory, folder);
    await mkdir(target, { recursive: true });
    await unzipInto(Buffer.from(await response.arrayBuffer()), target);
    written += 1;
  }
  return written;
}
