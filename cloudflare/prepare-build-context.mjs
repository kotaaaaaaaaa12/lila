import { copyFileSync } from 'node:fs';

// Wrangler sends the Dockerfile through stdin, so Docker reads the root ignore file.
const source = new URL('./Dockerfile.dockerignore', import.meta.url);
const destination = new URL('../.dockerignore', import.meta.url);
copyFileSync(source, destination);
console.log('Prepared the root Docker ignore file for the container build.');

