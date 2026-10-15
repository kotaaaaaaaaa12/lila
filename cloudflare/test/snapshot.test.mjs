import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SnapshotPublisher} from '../snapshot.mjs';
function fixture() {
  const state = new Map([['generation', 'current']]);
  const published = [];
  const storage = {get: async key => state.get(key), put: async (key, value) => {state.set(key, value);}};
  const publish = async (bucket, response, now, metadata) => {
    await new Promise(resolve => setTimeout(resolve, 1));
    published.push(metadata.sequence);
    return {...metadata, key: `archive-${metadata.sequence}`, createdAt: new Date(now).toISOString()};
  };
  const publisher = new SnapshotPublisher({get: async () => null, delete: async () => {}}, storage, publish);
  const response = (sequence, generation = 'current') => new Response('data', {headers: {
    'x-backup-generation': generation, 'x-backup-sequence': String(sequence),
  }});
  return {publisher, state, published, response};
}
test('late periodic backups cannot overwrite a newer shutdown checkpoint', async () => {
  const f = fixture();
  await Promise.all([f.publisher.accept(f.response(3)), f.publisher.accept(f.response(2))]);
  assert.deepEqual(f.published, [3]);
  assert.equal(f.state.get('lastBackup').sequence, 3);
});
test('retiring VMs cannot overwrite backups from a replacement VM', async () => {
  const f = fixture();
  await assert.rejects(f.publisher.accept(f.response(100, 'obsolete')), /obsolete/);
  assert.equal(f.published.length, 0);
  await f.publisher.accept(f.response(1));
  assert.equal(f.state.get('lastBackup').sequence, 1);
});
