import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runDocker } from '../docker-with-retry.mjs';

test('a transient managed-registry push retries the same image without rebuilding', async () => {
  const calls = [];
  const delays = [];
  const result = await runDocker(
    '/usr/bin/docker',
    ['push', 'registry.cloudflare.com/account/image:version'],
    {
      run: async (binary, args) => {
        calls.push({ binary, args });
        return { code: calls.length === 1 ? 1 : 0, signal: null };
      },
      wait: async delay => delays.push(delay),
      log: () => {},
    },
  );
  assert.equal(result.code, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(delays, [5000]);
});

test('persistent failure stops after three attempts and keeps its exit code', async () => {
  let calls = 0;
  const delays = [];
  const result = await runDocker('docker', ['push', 'registry.cloudflare.com/account/image:v1'], {
    run: async () => {
      calls++;
      return { code: 7, signal: null };
    },
    wait: async delay => delays.push(delay),
    log: () => {},
  });
  assert.equal(calls, 3);
  assert.equal(result.code, 7);
  assert.deepEqual(delays, [5000, 10000]);
});

test('other Docker commands and external-registry pushes never retry', async () => {
  for (const args of [
    ['build', '.'],
    ['image', 'rm', 'tag'],
    ['push', 'docker.io/account/image:v1'],
  ]) {
    let calls = 0;
    await runDocker('docker', args, {
      run: async () => {
        calls++;
        return { code: 1, signal: null };
      },
      wait: async () => assert.fail('Unexpected retry'),
    });
    assert.equal(calls, 1);
  }
});

test('termination signals stop retries immediately', async () => {
  const result = await runDocker('docker', ['push', 'registry.cloudflare.com/account/image:v1'], {
    run: async () => ({ code: null, signal: 'SIGTERM' }),
    wait: async () => assert.fail('Unexpected retry'),
  });
  assert.equal(result.signal, 'SIGTERM');
});
