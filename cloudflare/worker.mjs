import {Container, ContainerProxy} from '@cloudflare/containers';
import {loadBackup, publishBackup, publicRequest} from './persistence.mjs';
import {SnapshotPublisher} from './snapshot.mjs';
import {waitForStartup, startupResponse, fetchWithRetry} from './readiness.mjs';
import {startupPage} from './startup-page.mjs';

export {ContainerProxy};
const RELEASE = 'lichess-cloudflare-r2-20261014-v1';
const INSTANCE = 'primary-v1';

export class LichessServer extends Container {
  defaultPort = 8080;
  sleepAfter = '10m';
  enableInternet = true;
  bootPromise;
  bootInProgress = false;
  backupPromise;
  shutdownPromise;
  applicationReady = false;
  startupStage = 'idle';
  lastError = null;

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = Object.fromEntries([
      'PUBLIC_ORIGIN', 'PLAY_SECRET', 'USER_PASSWORD_SECRET', 'CONTAINER_CONTROL_TOKEN', 'FISHNET_KEY', 'ENGINE_ENABLED',
    ].map(key => [key, env[key] || '']));
    this.envVars.LOCAL_ACCOUNTS = 'true';
    this.publisher = new SnapshotPublisher(env.BACKUPS, ctx.storage, publishBackup);
  }

  stage(value) {
    this.startupStage = value;
    console.info('Lichess stage:', value, RELEASE);
  }

  control(path, init = {}) {
    const headers = new Headers(init.headers);
    headers.set('x-container-control', this.env.CONTAINER_CONTROL_TOKEN);
    return this.container.getTcpPort(8080).fetch(new Request(`http://container/_cf/${path}`, {...init, headers}));
  }

  async checkControl(path, init = {}) {
    const response = await this.control(path, init);
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      throw new Error(`${path} failed: HTTP ${response.status}: ${detail}`);
    }
    return response;
  }

  async ensureReady() {
    for (const key of ['PLAY_SECRET', 'USER_PASSWORD_SECRET', 'CONTAINER_CONTROL_TOKEN', 'FISHNET_KEY']) {
      if (!this.env[key] || this.env[key].length < 32) {
        this.stage('missing-secrets');
        throw new Error(`Configure ${key} before opening the site.`);
      }
    }
    if (!this.container.running && !this.bootInProgress) {
      this.bootPromise = undefined;
      this.applicationReady = false;
    }
    if (!this.bootPromise) {
      this.bootInProgress = true;
      this.bootPromise = this.boot().then(() => {
        this.bootInProgress = false;
      }).catch(error => {
        this.bootInProgress = false;
        this.bootPromise = undefined;
        this.applicationReady = false;
        this.lastError = error.message;
        console.error('Lichess startup failed:', this.startupStage, error.message);
        this.stage('failed');
        throw error;
      });
      this.ctx.waitUntil(this.bootPromise.catch(() => {}));
    }
    await this.bootPromise;
  }

  async boot() {
    this.lastError = null;
    this.stage('container-port');
    await this.startAndWaitForPorts({
      ports: [8080], cancellationOptions: {waitInterval: 1000, instanceGetTimeoutMS: 120_000, portReadyTimeoutMS: 180_000},
    });
    this.stage('database-ready');
    await this.checkControl('wait-databases', {method: 'POST'});
    const status = await (await this.checkControl('status')).json();
    let generation = status.generation;
    if (!status.initialized) {
      this.stage('backup-load');
      const backup = await loadBackup(this.env.BACKUPS);
      if (!backup && await this.ctx.storage.get('initialized')) {
        throw new Error('A previously initialized server has no committed backup. Refusing an empty database.');
      }
      if (backup) {
        this.stage('database-restore');
        await this.checkControl('restore', {
          method: 'POST', body: backup.archive.body,
          headers: {'content-type': 'application/gzip', 'x-backup-sha256': backup.manifest.sha256},
        });
      }
      generation = crypto.randomUUID();
      // Fence a retiring instance before this instance starts accepting writes.
      await this.publisher.queue;
      await this.ctx.storage.put('generation', generation);
    } else if (generation !== await this.ctx.storage.get('generation')) {
      throw new Error('The running database belongs to an obsolete container generation.');
    }
    if (!status.ready) {
      this.stage('application-initialize');
      await this.checkControl('initialize', {
        method: 'POST', body: JSON.stringify({generation}), headers: {'content-type': 'application/json'},
      });
    }
    // Always commit an initial checkpoint before exposing an initialized database.
    this.stage('initial-backup');
    await this.saveBackup();
    await this.ctx.storage.put('initialized', true);
    this.applicationReady = true;
    this.stage('ready');
    await this.armCheckpoint();
  }

  async saveBackup(final = false) {
    while (this.backupPromise) {
      const previous = await this.backupPromise;
      if (!final) return previous;
    }
    if (!this.backupPromise) {
      this.backupPromise = (async () => {
        const response = await this.checkControl(final ? 'quiesce-backup' : 'backup', {method: 'POST'});
        const manifest = await this.publisher.accept(response);
        if (final) await this.checkControl('committed', {
          method: 'POST', body: JSON.stringify({sequence: manifest.sequence}), headers: {'content-type': 'application/json'},
        });
        return manifest;
      })().finally(() => {this.backupPromise = undefined;});
    }
    return this.backupPromise;
  }

  async ingestBackup(request) {
    if (request.headers.get('x-container-control') !== this.env.CONTAINER_CONTROL_TOKEN || request.method !== 'POST') {
      return new Response('Not found', {status: 404});
    }
    try {
      const manifest = await this.publisher.accept(new Response(request.body, {headers: request.headers}));
      return Response.json({ok: true, sequence: manifest.sequence});
    } catch (error) {
      console.error('Shutdown backup failed:', error.message);
      return new Response('Backup publication failed.', {status: 500});
    }
  }

  async armCheckpoint() {
    this.deleteSchedules('checkpoint');
    const configured = Number(this.env.BACKUP_INTERVAL_SECONDS || 60);
    const seconds = Number.isFinite(configured) ? Math.max(15, Math.min(300, configured)) : 60;
    await this.schedule(seconds, 'checkpoint');
  }

  async checkpoint() {
    if (!this.container.running) return;
    try {
      if (!this.shutdownPromise) {
        await this.ensureReady();
        await this.saveBackup();
      }
    } catch (error) {
      this.lastError = error.message;
      console.error('Checkpoint failed:', error.message);
    } finally {
      if (this.container.running && !this.shutdownPromise) await this.armCheckpoint();
    }
  }

  async onActivityExpired() {
    if (!this.container.running) return;
    if (!this.shutdownPromise) {
      this.shutdownPromise = (async () => {
        try {
          await this.ensureReady();
          this.applicationReady = false;
          this.stage('final-backup');
          this.deleteSchedules('checkpoint');
          await this.saveBackup(true);
          this.stage('idle-shutdown');
          const exited = this.container.monitor();
          await this.stop();
          await exited;
        } catch (error) {
          // Resume services after a failed final checkpoint; do not discard the database.
          console.error('Idle shutdown deferred:', error.message);
          this.bootPromise = undefined;
          this.lastError = error.message;
          if (this.container.running) {
            await this.ensureReady();
            await this.armCheckpoint();
          }
        }
      })();
    }
    try {await this.shutdownPromise;}
    finally {this.shutdownPromise = undefined;}
  }

  async onStop() {
    this.deleteSchedules('checkpoint');
    this.bootPromise = undefined;
    this.applicationReady = false;
    this.stage('stopped');
  }
  async onError() {
    this.deleteSchedules('checkpoint');
    this.bootPromise = undefined;
    this.applicationReady = false;
    this.stage('container-error');
  }

  async health() {
    if (this.container.running) {
      try {
        const status = await (await this.checkControl('status')).json();
        if (!status.ready) this.applicationReady = false;
      } catch {this.applicationReady = false;}
    } else this.applicationReady = false;
    const lastBackup = await this.ctx.storage.get('lastBackup');
    return Response.json({
      ready: this.applicationReady, running: this.container.running,
      stage: this.startupStage, release: RELEASE, error: this.lastError,
      lastBackupAt: lastBackup?.createdAt || null,
    }, {headers: {'cache-control': 'no-store'}});
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/healthz') return this.health();
    const forwarded = publicRequest(request, this.env.PUBLIC_ORIGIN);
    if (!forwarded || path === '/fishnet' || path.startsWith('/fishnet/')) return new Response('Not found', {status: 404});
    if (this.shutdownPromise && !await waitForStartup(this.shutdownPromise, 8000)) {
      return starting(request, 'idle-shutdown');
    }
    this.renewActivityTimeout();
    try {
      if (!await waitForStartup(this.ensureReady(), 8000)) return starting(request, this.startupStage);
      return await this.containerFetch(forwarded);
    } catch (error) {
      this.lastError = error.message;
      console.error('Lichess request failed:', error.message);
      return starting(request, this.startupStage);
    }
  }
}

LichessServer.outboundByHost = {
  'cf.backup': (request, env) => env.LICHESS.get(env.LICHESS.idFromName(INSTANCE)).ingestBackup(request),
};

function starting(request, stage) {
  if (request.method !== 'GET' || !request.headers.get('accept')?.includes('text/html')) return startupResponse(stage, RELEASE);
  return new Response(startupPage(stage), {
    headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '5'},
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/_cf')) return new Response('Not found', {status: 404});
    const origin = new URL(env.PUBLIC_ORIGIN);
    if (url.host !== origin.host) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Use the canonical site address.', {status: 421});
      url.host = origin.host;
      url.protocol = origin.protocol;
      return Response.redirect(url.toString(), 308);
    }
    try {return await fetchWithRetry(request, env.LICHESS, env.LICHESS.idFromName(INSTANCE));}
    catch (error) {
      console.error('Worker routing failed:', error.message);
      return starting(request, 'request-failed');
    }
  },
};
