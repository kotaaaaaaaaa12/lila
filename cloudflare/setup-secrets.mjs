import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(config.name)}/secrets`;
async function call(method, body) {
  const response = await fetch(endpoint, {
    method, headers: {'authorization': `Bearer ${token}`, 'content-type': 'application/json'},
    ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(`Worker secret configuration failed: HTTP ${response.status}`);
  return result.result;
}
const existing = new Set((await call('GET')).map(secret => secret.name));
for (const name of ['PLAY_SECRET', 'USER_PASSWORD_SECRET', 'CONTAINER_CONTROL_TOKEN', 'FISHNET_KEY']) {
  if (existing.has(name)) {
    console.log(`Preserved existing ${name}.`);
    continue;
  }
  // Password encryption keys must remain stable across redeployments.
  const text = randomBytes(32).toString(name === 'USER_PASSWORD_SECRET' ? 'base64' : 'hex');
  await call('PUT', {name, text, type: 'secret_text'});
  console.log(`Created ${name}.`);
}
