import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildConfiguration} from '../runtime/config.mjs';
const env = {
  PUBLIC_ORIGIN: 'https://chess.test', PLAY_SECRET: 'p'.repeat(64),
  USER_PASSWORD_SECRET: Buffer.alloc(32, 1).toString('base64'),
  CONTAINER_CONTROL_TOKEN: 'c'.repeat(64), FISHNET_KEY: 'f'.repeat(64),
};
test('configuration loads packaged defaults without recursive local includes', () => {
  const config = buildConfiguration(env);
  assert.match(config.app, /include required\(classpath\("base.conf"\)\)/);
  assert.match(config.socket, /include required\(classpath\("application.conf"\)\)/);
  assert.match(config.app, /play\.server\.dir = "\/opt\/lichess\/app"/);
  assert.match(config.app, /play\.mode = "prod"/);
  assert.match(config.socket, /csrf.origin = "https:\/\/chess.test"/);
  assert.doesNotMatch(config.app + config.socket, /lishogi|localhost:8080/);
});
test('malformed AES keys are rejected before starting Java', () => {
  assert.throws(() => buildConfiguration({...env, USER_PASSWORD_SECRET: 'not-valid-base64'.repeat(4)}), /32 random bytes/);
});
test('paths and credentials cannot enter the public origin configuration', () => {
  for (const origin of ['http://chess.test', 'https://chess.test/path', 'https://user@chess.test', 'https://chess.test/?x=1']) {
    assert.throws(() => buildConfiguration({...env, PUBLIC_ORIGIN: origin}), /public HTTPS origin/);
  }
});
