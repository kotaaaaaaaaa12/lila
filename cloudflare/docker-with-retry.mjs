import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function runDocker(
  binary,
  args,
  {
    run = (command, argv) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, argv, { stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
        for (const signal of ['SIGINT', 'SIGTERM']) {
          const forward = () => child.kill(signal);
          process.once(signal, forward);
          child.once('exit', () => process.removeListener(signal, forward));
        }
      }),
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    log = message => console.error(message),
  } = {},
) {
  // Retry only Cloudflare image pushes; builds and other commands run once.
  const managedPush =
    args.length === 2 && args[0] === 'push' && args[1].startsWith('registry.cloudflare.com/');
  const attempts = managedPush ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await run(binary, args);
    if (result.signal || result.code === 0 || attempt === attempts) return result;
    log(
      `Container image push failed. Retrying the existing image (${attempt + 1}/${attempts}) without rebuilding.`,
    );
    await wait(attempt * 5000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [binary, ...args] = process.argv.slice(2);
  if (!binary) throw new Error('The original Docker executable is required.');
  const result = await runDocker(binary, args);
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.code ?? 1;
}
