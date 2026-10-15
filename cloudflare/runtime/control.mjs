import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdir, rm, stat} from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createHash, timingSafeEqual} from 'node:crypto';
import {writeConfiguration} from './config.mjs';

const children = new Set();
let ready = false;
let initialized = false;
let generation = '';
let sequence = 0;
let finalCommitted = false;
let stopping = false;
let errorMessage = null;
let operation = Promise.resolve();
const mongoUri = 'mongodb://localhost:27017/?replicaSet=rs0';
const archivePath = '/run/lichess/backup.archive.gz';
const restorePath = '/run/lichess/restore.archive.gz';
const maximum = 1024 * 1024 * 1024;

function log(message) {console.log(`[cloudflare] ${message}`);}
function authenticated(request) {
  const actual = Buffer.from(request.headers['x-container-control'] || '');
  const expected = Buffer.from(process.env.CONTAINER_CONTROL_TOKEN || '');
  return expected.length >= 32 && actual.length === expected.length && timingSafeEqual(actual, expected);
}
function serial(task) {
  const result = operation.then(task);
  operation = result.catch(() => {});
  return result;
}
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'inherit', 'inherit'], ...options});
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed with ${code ?? signal}.`)));
  });
}
function start(command, args, group, options = {}) {
  const child = spawn(command, args, {stdio: ['ignore', 'inherit', 'inherit'], detached: true, ...options});
  child.group = group;
  child.expectedStop = false;
  children.add(child);
  child.on('error', error => {
    errorMessage = `${command} could not start: ${error.code}`;
    log(errorMessage);
    void shutdown(1);
  });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping && !child.expectedStop) {
      errorMessage = `${command} stopped: ${code ?? signal}`;
      log(errorMessage);
      void shutdown(1);
    }
  });
  return child;
}
function terminate(child, signal = 'SIGTERM') {
  child.expectedStop = true;
  try {process.kill(-child.pid, signal);}
  catch (error) {if (error.code !== 'ESRCH') throw error;}
}
async function stopGroup(group, timeout = 45_000) {
  const current = [...children].filter(child => child.group === group);
  const exits = current.map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
  }));
  for (const child of current) terminate(child);
  let timer;
  const complete = await Promise.race([
    Promise.all(exits).then(() => true),
    new Promise(resolve => {timer = setTimeout(() => resolve(false), timeout);}),
  ]);
  clearTimeout(timer);
  if (!complete) {
    for (const child of current) if (children.has(child)) terminate(child, 'SIGKILL');
    await Promise.all(exits);
    throw new Error(`Service group ${group} did not stop cleanly.`);
  }
}
async function waitPort(port, timeout = 180_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (stopping) throw new Error('The container is stopping.');
    const found = await new Promise(resolve => {
      const socket = net.connect({host: '127.0.0.1', port});
      socket.setTimeout(1000);
      socket.on('connect', () => {socket.destroy(); resolve(true);});
      socket.on('error', () => {socket.destroy(); resolve(false);});
      socket.on('timeout', () => {socket.destroy(); resolve(false);});
    });
    if (found) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Service on port ${port} did not become ready.`);
}
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function readJson(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 4096) throw new Error('Control message is too large.');
  }
  return JSON.parse(text);
}

async function bootDatabases() {
  await writeConfiguration(process.env);
  await Promise.all(['/data/mongo', '/data/redis', '/data/fishnet-play', '/data/fishnet-analysis', '/run/lichess'].map(path => mkdir(path, {recursive: true})));
  start('mongod', [
    '--dbpath', '/data/mongo', '--bind_ip', '127.0.0.1', '--replSet', 'rs0',
    '--wiredTigerCacheSizeGB', '0.5', '--oplogSize', '512', '--quiet',
  ], 'database');
  start('redis-server', [
    '--bind', '127.0.0.1', '--protected-mode', 'yes', '--dir', '/data/redis',
    '--appendonly', 'no', '--save', '', '--maxmemory', '256mb', '--maxmemory-policy', 'noeviction',
  ], 'database');
  await waitPort(27017);
  await waitPort(6379);
  await run('mongosh', ['--quiet', 'mongodb://127.0.0.1:27017/admin', '--eval', `
    try {rs.status();}
    catch (error) {
      if (error.code !== 94) throw error;
      rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]});
    }
    for (let i = 0; i < 120 && !db.hello().isWritablePrimary; i++) sleep(500);
    if (!db.hello().isWritablePrimary) throw new Error('MongoDB did not elect a primary.');
  `]);
  log('MongoDB and Redis are ready.');
}

async function initialize(config) {
  if (ready) return;
  if (!/^[0-9a-f-]{36}$/.test(config.generation || '')) throw new Error('A valid container generation is required.');
  if (initialized && generation !== config.generation) throw new Error('Refusing to change a live database generation.');
  generation = config.generation;
  finalCommitted = false;
  await run('mongosh', ['--quiet', mongoUri, '--eval', `
    const local = db.getSiblingDB('lichess');
    local.fishnet_client.updateOne({_id: process.env.FISHNET_KEY}, {
      $set: {userId: 'lichess', skill: 'all', enabled: true},
      $setOnInsert: {createdAt: new Date()}
    }, {upsert: true});
    local.flag.updateOne({_id: 'canSendEmails'}, {$set: {setting: false}}, {upsert: true});
    local.user4.createIndex({username: 1});
    local.user4.createIndex({email: 1});
    local.game5.createIndex({'p.uid': 1, ca: -1});
    local.security.createIndex({date: 1}, {expireAfterSeconds: 315360000});
  `]);
  start('/opt/lichess/app/bin/lila', [
    '-Dconfig.file=/run/lichess/site.conf', '-Dplay.server.dir=/opt/lichess/app',
    '-Dplay.mode=prod', '-Dreactivemongo.api.bson.document.strict=false',
    '-J-Xms128m', '-J-Xmx2g', '-J-XX:ActiveProcessorCount=2',
  ], 'application', {cwd: '/opt/lichess/app'});
  start('/opt/lila-ws/bin/lila-ws', [
    '-Dconfig.file=/run/lichess/socket.conf', '-J-Xms32m', '-J-Xmx384m', '-J-XX:ActiveProcessorCount=2',
  ], 'application', {cwd: '/opt/lila-ws'});
  await waitPort(9663);
  await waitPort(9664);
  // A listening socket alone is insufficient: check the real lobby response.
  let lobbyReady = false;
  const until = Date.now() + 60_000;
  while (Date.now() < until && !lobbyReady) {
    const response = await fetch('http://127.0.0.1:9663/', {
      headers: {host: new URL(process.env.PUBLIC_ORIGIN).host}, redirect: 'manual', signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    lobbyReady = response.status >= 200 && response.status < 400;
    if (!lobbyReady) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!lobbyReady) throw new Error('The lobby did not return a successful HTTP response.');
  await run('nginx', ['-t', '-c', '/run/lichess/nginx.conf']);
  start('nginx', ['-c', '/run/lichess/nginx.conf'], 'application');
  await waitPort(8082);
  if (process.env.ENGINE_ENABLED !== 'false') {
    start('/opt/lila-fishnet/bin/lila-fishnet', [
      '-J-Xms32m', '-J-Xmx256m', '-J-XX:ActiveProcessorCount=2',
    ], 'application', {cwd: '/opt/lila-fishnet', env: {...process.env, REDIS_HOST: '127.0.0.1', HTTP_HOST: '127.0.0.1'}});
    await waitPort(9665);
    for (const [type, port] of [['play', 9665], ['analysis', 9663]]) {
      start('/opt/fishnet/fishnet', [
        '--no-conf', '--no-stats-file', '--key', process.env.FISHNET_KEY,
        '--cores', '1', '--max-backoff', '5', '--endpoint', `http://127.0.0.1:${port}/fishnet`,
      ], 'application', {cwd: `/data/fishnet-${type}`});
    }
  }
  initialized = true;
  ready = true;
  errorMessage = null;
  log('Lichess application services are ready.');
}

async function quiesce() {
  ready = false;
  await stopGroup('application');
  log('Application writes have stopped.');
}

async function createBackup() {
  if (!initialized) throw new Error('Cannot back up an uninitialized application.');
  await run('mongodump', ['--uri', mongoUri, `--archive=${archivePath}`, '--gzip', '--oplog', '--quiet']);
  const info = await stat(archivePath);
  if (!info.size || info.size > maximum) throw new Error('Backup archive exceeds the supported size.');
  sequence++;
  return {
    'content-type': 'application/gzip', 'content-length': String(info.size),
    'x-backup-sha256': await hashFile(archivePath), 'x-backup-generation': generation,
    'x-backup-sequence': String(sequence), 'cache-control': 'no-store',
  };
}

async function backup(response, final) {
  if (final) await quiesce();
  const headers = await createBackup();
  response.writeHead(200, headers);
  try {await pipeline(createReadStream(archivePath), response);}
  finally {await rm(archivePath, {force: true});}
}

async function restore(request) {
  if (initialized || ready) throw new Error('Cannot restore over an initialized database.');
  const expected = request.headers['x-backup-sha256'];
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('A restore requires its committed SHA-256 checksum.');
  let size = 0;
  const hash = createHash('sha256');
  const check = new Transform({transform(chunk, encoding, callback) {
    size += chunk.length;
    if (size > maximum) return callback(new Error('Restore archive is too large.'));
    hash.update(chunk);
    callback(null, chunk);
  }});
  try {
    await pipeline(request, check, createWriteStream(restorePath, {mode: 0o600}));
    if (!size || hash.digest('hex') !== expected) throw new Error('Restore archive checksum does not match.');
    await run('mongorestore', [
      '--uri', mongoUri, `--archive=${restorePath}`, '--gzip', '--oplogReplay', '--drop', '--stopOnError', '--quiet',
    ]);
  } finally {await rm(restorePath, {force: true});}
}

function proxy(request, response) {
  if (!ready || stopping) {
    response.writeHead(503, {'retry-after': '5', 'content-type': 'text/plain'});
    return response.end('The application is starting or stopping.');
  }
  const headers = {...request.headers};
  delete headers['x-container-control'];
  const upstream = http.request({hostname: '127.0.0.1', port: 8082, method: request.method, path: request.url, headers}, incoming => {
    response.writeHead(incoming.statusCode, incoming.headers);
    incoming.pipe(response);
    incoming.on('error', () => response.destroy());
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, {'content-type': 'text/plain'});
    response.end('The application service is unavailable.');
  });
  request.on('aborted', () => upstream.destroy());
  response.on('close', () => {if (!response.writableEnded) upstream.destroy();});
  request.pipe(upstream);
}

let databaseReady;
const server = http.createServer(async (request, response) => {
  const path = new URL(request.url, 'http://container').pathname;
  if (!path.startsWith('/_cf/')) return proxy(request, response);
  if (!authenticated(request)) {response.writeHead(404); return response.end();}
  if (path === '/_cf/status' && request.method === 'GET') {
    response.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'});
    return response.end(JSON.stringify({ready, initialized, generation, sequence, stopping, error: errorMessage}));
  }
  if (request.method !== 'POST') {response.writeHead(405); return response.end();}
  try {
    await serial(async () => {
      await databaseReady;
      if (path === '/_cf/backup') return backup(response, false);
      if (path === '/_cf/quiesce-backup') return backup(response, true);
      if (path === '/_cf/restore') await restore(request);
      else if (path === '/_cf/initialize') {
        try {await initialize(await readJson(request));}
        catch (error) {ready = false; await stopGroup('application').catch(() => {}); throw error;}
      }
      else if (path === '/_cf/committed') {
        const message = await readJson(request);
        if (ready || message.sequence !== sequence) throw new Error('Final checkpoint has not been committed.');
        finalCommitted = true;
      }
      else if (path !== '/_cf/wait-databases') {response.writeHead(404); return response.end();}
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({ok: true}));
    });
  } catch (error) {
    errorMessage = error.message;
    log(`Control operation failed: ${error.message}`);
    if (!response.headersSent) response.writeHead(500, {'content-type': 'text/plain'});
    response.end(error.message);
  }
});

server.on('upgrade', (request, socket, head) => {
  if (!ready || stopping || new URL(request.url, 'http://container').pathname.startsWith('/_cf')) {
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return;
  }
  const headers = {...request.headers};
  delete headers['x-container-control'];
  const upstream = http.request({hostname: '127.0.0.1', port: 8082, path: request.url, headers});
  upstream.on('upgrade', (incoming, upstreamSocket, upstreamHead) => {
    const lines = [`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}`];
    for (let i = 0; i < incoming.rawHeaders.length; i += 2) lines.push(`${incoming.rawHeaders[i]}: ${incoming.rawHeaders[i + 1]}`);
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    socket.pipe(upstreamSocket).pipe(socket);
    socket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => socket.destroy());
    socket.on('close', () => upstreamSocket.destroy());
    upstreamSocket.on('close', () => socket.destroy());
  });
  upstream.on('response', response => {response.resume(); socket.end(`HTTP/1.1 ${response.statusCode} Upgrade Failed\r\nConnection: close\r\n\r\n`);});
  upstream.on('error', () => socket.destroy());
  upstream.end();
});

async function uploadShutdownBackup() {
  const headers = await createBackup();
  headers['x-container-control'] = process.env.CONTAINER_CONTROL_TOKEN;
  const response = await fetch('http://cf.backup/commit', {
    method: 'POST', headers, body: createReadStream(archivePath), duplex: 'half', signal: AbortSignal.timeout(180_000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Shutdown backup failed: HTTP ${response.status}`);
  finalCommitted = true;
  log('Shutdown backup was committed to R2.');
}

let shutdownPromise;
function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  ready = false;
  // SIGKILL and OOM cannot execute this handler; periodic checkpoints remain essential.
  shutdownPromise = serial(async () => {
    try {
      await quiesce();
      if (initialized && !finalCommitted) await uploadShutdownBackup();
    } catch (error) {log(`Shutdown checkpoint failed: ${error.message}`); code = 1;}
    await stopGroup('database', 30_000).catch(error => {log(error.message); code = 1;});
    server.close();
    process.exit(code);
  });
  const deadline = setTimeout(() => process.exit(1), 240_000);
  deadline.unref();
  return shutdownPromise;
}

process.on('SIGTERM', () => {void shutdown();});
process.on('SIGINT', () => {void shutdown();});
server.listen(8080, '0.0.0.0', () => {
  log('Control service is listening.');
  databaseReady = bootDatabases();
  databaseReady.catch(error => {errorMessage = error.message; log(`Database startup failed: ${error.message}`); void shutdown(1);});
});
