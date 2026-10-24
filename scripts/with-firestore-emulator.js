/**
 * Starts the Firestore emulator, runs a command with FIRESTORE_EMULATOR_HOST
 * pointing at it, then stops the emulator. Used to run the store tests against
 * Firestore without a Google Cloud project:
 *
 *   node scripts/with-firestore-emulator.js node --test test/store.test.js
 *
 * Needs the Google Cloud CLI with the emulator installed
 * (`gcloud components install cloud-firestore-emulator`) and Java 11 or later.
 */
import { execFileSync, spawn } from 'node:child_process';

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error('Usage: node scripts/with-firestore-emulator.js <command> [args...]');
  process.exit(1);
}

const HOST = `127.0.0.1:${Number(process.env.FIRESTORE_EMULATOR_PORT) || 8085}`;
const windows = process.platform === 'win32';

// On Windows, gcloud and npm are .cmd scripts, which only start through a shell.
// The shell gets one command line, since Node no longer joins arguments for it.
function run(args, options) {
  return windows ? spawn(args.join(' '), { ...options, shell: true }) : spawn(args[0], args.slice(1), options);
}

const emulator = run(['gcloud', 'emulators', 'firestore', 'start', `--host-port=${HOST}`, '--quiet'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
emulator.stdout.on('data', (d) => (output += d));
emulator.stderr.on('data', (d) => (output += d));

function stopEmulator() {
  if (emulator.exitCode !== null) return;
  // On Windows the emulator's Java process is a grandchild; kill the whole tree.
  if (windows) execFileSync('taskkill', ['/pid', String(emulator.pid), '/T', '/F'], { stdio: 'ignore' });
  else emulator.kill();
}

async function waitForEmulator(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (emulator.exitCode !== null) throw new Error(`The Firestore emulator exited early:\n${output}`);
    try {
      if ((await fetch(`http://${HOST}/`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for the Firestore emulator:\n${output}`);
}

let code = 1;
try {
  await waitForEmulator();
  console.log(`Firestore emulator running at ${HOST}`);
  code = await new Promise((resolve) => {
    const child = run(command, { env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, stdio: 'inherit' });
    child.on('exit', (exitCode) => resolve(exitCode ?? 1));
  });
} catch (err) {
  console.error(err.message);
} finally {
  stopEmulator();
}
process.exit(code);
