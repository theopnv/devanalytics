import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { collectorRegistry } from '../../action/src/generated/collector-registry.ts';
import type { CollectorEntry } from '../contract.ts';
import { inputVariable, readCoreInputs, readMetricInputs } from './inputs.ts';
import { runAction } from './run.ts';
import { UploadError } from './upload.ts';

const [{ metric: exampleMetric }] = collectorRegistry as [CollectorEntry];
const fixtures = path.join(import.meta.dirname, '..', '..', 'metrics', 'example', 'fixtures');

const baseEnv = {
  [inputVariable('metric')]: 'example',
  [inputVariable('worker-url')]: 'https://worker.example/',
  [inputVariable('token')]: 'secret-token',
  [inputVariable('working-directory')]: '.',
  [inputVariable('file')]: 'snapshot.json',
};

function deps(send: typeof fetch) {
  const lines: string[] = [];
  return { lines, deps: { log: (line: string) => lines.push(line), cwd: fixtures, uploadOptions: { fetch: send, retryDelays: [] } } };
}

describe('inputs', () => {
  test('name the environment variable like the runner does', () => {
    expect(inputVariable('worker-url')).toBe('INPUT_WORKER-URL');
    expect(inputVariable('test pattern')).toBe('INPUT_TEST_PATTERN');
  });

  test('read the core inputs and remove the trailing slash of the URL', () => {
    expect(readCoreInputs(baseEnv)).toEqual({ metric: 'example', token: 'secret-token', workerUrl: 'https://worker.example', workingDirectory: '.' });
  });

  test.each([
    ['the metric', 'metric', 'Set the metric input.'],
    ['the token', 'token', 'DEVANALYTICS_INGEST_TOKEN'],
    ['the Worker URL', 'worker-url', 'DEVANALYTICS_URL'],
  ])('refuse an empty value for %s', (_label, name, message) => {
    expect(() => readCoreInputs({ ...baseEnv, [inputVariable(name)]: '  ' })).toThrow(message);
  });

  test('refuse a Worker URL that is not an http(s) URL', () => {
    expect(() => readCoreInputs({ ...baseEnv, [inputVariable('worker-url')]: 'not a url' })).toThrow('is not a URL');
    expect(() => readCoreInputs({ ...baseEnv, [inputVariable('worker-url')]: 'ftp://worker.example' })).toThrow('must start with https://');
  });

  test('apply the default of a metric input and leave out an input without a value', () => {
    const specs = [
      { name: 'include', description: '', default: 'src/**' },
      { name: 'exclude', description: '' },
      { name: 'limit', description: '', default: '15' },
    ];

    expect(readMetricInputs(specs, { [inputVariable('limit')]: ' 20 ' })).toEqual({ include: 'src/**', limit: '20' });
  });
});

describe('runAction', () => {
  test('collects the fixture and uploads it to the route of the metric', async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({ rowsWritten: 3 }));
    const { lines, deps: runDeps } = deps(send);

    await runAction(collectorRegistry, baseEnv, runDeps);

    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe('https://worker.example/v1/example/ingest');
    expect(JSON.parse(init?.body as string)).toMatchObject({ sha: '0123456789abcdef0123456789abcdef01234567', items: [{ name: 'alpha' }, { name: 'beta' }] });
    expect(lines).toEqual(['example: uploaded 0123456789abcdef0123456789abcdef01234567, 3 rows written.']);
  });

  test('resolves working-directory from the workspace', async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({ rowsWritten: 1 }));
    const { deps: runDeps } = deps(send);

    await runAction(collectorRegistry, { ...baseEnv, [inputVariable('working-directory')]: 'fixtures', [inputVariable('file')]: 'snapshot.json' }, { ...runDeps, cwd: path.dirname(fixtures) });

    expect(send).toHaveBeenCalledTimes(1);
  });

  test('fails before it collects when the token is empty', async () => {
    const collect = vi.fn();
    const registry: CollectorEntry[] = [{ metric: exampleMetric, collector: { inputs: [], collect } }];
    const { deps: runDeps } = deps(vi.fn<typeof fetch>());

    await expect(runAction(registry, { ...baseEnv, [inputVariable('token')]: '' }, runDeps)).rejects.toThrow('DEVANALYTICS_INGEST_TOKEN');
    expect(collect).not.toHaveBeenCalled();
  });

  test('names the metrics of this version when the metric is unknown', async () => {
    const { deps: runDeps } = deps(vi.fn<typeof fetch>());

    await expect(runAction(collectorRegistry, { ...baseEnv, [inputVariable('metric')]: 'nope' }, runDeps)).rejects.toThrow(
      'Unknown metric "nope". The metrics in this version are: example.',
    );
  });

  test('fails when the collector makes a snapshot that is not valid, and sends nothing', async () => {
    const send = vi.fn<typeof fetch>();
    const registry: CollectorEntry[] = [{
      metric: exampleMetric,
      collector: { inputs: [], collect: async () => ({ sha: 'short', date: 'now' }) },
    }];
    const { deps: runDeps } = deps(send);

    await expect(runAction(registry, baseEnv, runDeps)).rejects.toThrow('The example collector made a snapshot that is not valid: sha must be');
    expect(send).not.toHaveBeenCalled();
  });

  test('fails the step when the upload fails', async () => {
    const { deps: runDeps } = deps(vi.fn<typeof fetch>(async () => Response.json({ error: 'unauthorized' }, { status: 401 })));

    await expect(runAction(collectorRegistry, baseEnv, runDeps)).rejects.toBeInstanceOf(UploadError);
  });
});
