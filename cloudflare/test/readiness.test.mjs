import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {waitForStartup, fetchWithRetry} from '../readiness.mjs';

let source = await readFile(new URL('../worker.mjs', import.meta.url), 'utf8');
source = source.replace(/^import .+;\n/gm, '').replace('export {ContainerProxy};', '').replace('export class LichessServer', 'class LichessServer');
source = source.slice(0, source.indexOf('\nLichessServer.outboundByHost')) + '\nglobalThis.Server = LichessServer;';
const context = {
  Container: class {constructor(ctx, env) {this.ctx = ctx; this.env = env; this.container = {running: false};}},
  SnapshotPublisher: class {}, console, crypto, Response, Request, Headers, publishBackup() {},
};
runInNewContext(source, context);
function server() {
  return new context.Server({storage: {}, waitUntil() {}}, {
    PLAY_SECRET: 'p'.repeat(32), USER_PASSWORD_SECRET: 'u'.repeat(44),
    CONTAINER_CONTROL_TOKEN: 'c'.repeat(32), FISHNET_KEY: 'f'.repeat(32), BACKUPS: {},
  });
}
test('concurrent first requests share one boot before the VM reports running', async () => {
  const instance = server();
  let count = 0;
  let release;
  instance.boot = () => {count++; return new Promise(resolve => {release = resolve;});};
  const first = instance.ensureReady();
  const second = instance.ensureReady();
  assert.equal(count, 1);
  release();
  await Promise.all([first, second]);
});
test('a failed boot is retryable without retaining a rejected promise', async () => {
  const instance = server();
  instance.boot = async () => {throw new Error('Initialization failed');};
  await assert.rejects(instance.ensureReady(), /Initialization failed/);
  assert.equal(instance.bootPromise, undefined);
  instance.boot = async () => {};
  await instance.ensureReady();
});
test('a browser timeout does not cancel database initialization', async () => {
  let complete = false;
  const operation = new Promise(resolve => setTimeout(() => {complete = true; resolve();}, 30));
  assert.equal(await waitForStartup(operation, 1), false);
  await operation;
  assert.equal(complete, true);
});
test('idle shutdown obtains a final checkpoint before stopping the VM', async () => {
  const instance = server();
  instance.container.running = true;
  const calls = [];
  instance.ensureReady = async () => {};
  instance.deleteSchedules = () => {};
  instance.saveBackup = async final => {assert.equal(final, true); calls.push('final-backup');};
  instance.container.monitor = async () => {};
  instance.stop = async () => {calls.push('stop'); instance.container.running = false;};
  await instance.onActivityExpired();
  assert.deepEqual(calls, ['final-backup', 'stop']);
});
test('failed final backup preserves the running database and rearms checkpoints', async () => {
  const instance = server();
  instance.container.running = true;
  let stopCount = 0;
  let rearmed = false;
  instance.ensureReady = async () => {};
  instance.deleteSchedules = () => {};
  instance.saveBackup = async () => {throw new Error('R2 unavailable');};
  instance.stop = async () => {stopCount++;};
  instance.armCheckpoint = async () => {rearmed = true;};
  await instance.onActivityExpired();
  assert.equal(stopCount, 0);
  assert.equal(rearmed, true);
});
test('final backup cannot reuse a checkpoint from before services were quiesced', async () => {
  const instance = server();
  const calls = [];
  instance.backupPromise = Promise.resolve({sequence: 1}).finally(() => {instance.backupPromise = undefined;});
  instance.checkControl = async path => {calls.push(path); return new Response('archive');};
  instance.publisher = {accept: async () => ({sequence: 2})};
  await instance.saveBackup(true);
  assert.deepEqual(calls, ['quiesce-backup', 'committed']);
});
test('safe reads retry a broken Durable Object stub but writes are never replayed', async () => {
  let calls = 0;
  const namespace = {get() {return {fetch: async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('Object reset'), {retryable: true});
    return new Response('ok');
  }};}};
  assert.equal(await (await fetchWithRetry(new Request('https://chess.test/'), namespace, 'id', {pause: async () => {}})).text(), 'ok');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(fetchWithRetry(new Request('https://chess.test/', {method: 'POST'}), namespace, 'id', {pause: async () => {}}));
  assert.equal(calls, 1);
});
