import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Wrangler sends the Dockerfile through stdin, so Docker reads the root ignore file.
const source = new URL('./Dockerfile.dockerignore', import.meta.url);
const destination = new URL('../.dockerignore', import.meta.url);
copyFileSync(source, destination);
console.log('Prepared the root Docker ignore file for the container build.');

const root = fileURLToPath(new URL('../', import.meta.url));
const binDirectory = join(root, 'node_modules', '.bin');
const shim = join(binDirectory, 'docker');
const marker = '# lichess-cloudflare-docker-retry';
const pathEntries = (process.env.PATH || '').split(delimiter).map(entry => resolve(entry || '.'));
const docker = pathEntries
  .map(entry => join(entry, 'docker'))
  .find(candidate => {
    if (resolve(candidate) === shim) return false;
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate) !== shim;
    } catch {
      return false;
    }
  });

// npx puts the repository's .bin directory on PATH before the system Docker.
// The wrapper keeps Wrangler's image build, authentication, and rollout flow intact.
if (docker) {
  if (
    pathEntries.indexOf(binDirectory) < 0 ||
    pathEntries.indexOf(binDirectory) > pathEntries.indexOf(dirname(docker))
  ) {
    throw new Error('Run deployment with npx wrangler deploy so the local Docker retry wrapper is on PATH.');
  }
  if (existsSync(shim) && !readFileSync(shim, 'utf8').includes(marker)) {
    throw new Error('Refusing to overwrite an unrelated local Docker executable.');
  }
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const runner = fileURLToPath(new URL('./docker-with-retry.mjs', import.meta.url));
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(
    shim,
    `#!/bin/sh\n${marker}\nexec ${quote(process.execPath)} ${quote(runner)} ${quote(docker)} "$@"\n`,
    { mode: 0o755 },
  );
  console.log('Prepared up to three attempts for Cloudflare image pushes without rebuilding.');
} else {
  console.log('Docker is unavailable here; Worker-only checks can still run.');
}
