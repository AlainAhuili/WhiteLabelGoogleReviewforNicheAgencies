/**
 * Acceptance stage: deploys the system into a production-like environment with
 * Google stubbed at the boundary, then runs the smoke tests and acceptance tests.
 *
 *   IMAGE=reputation-widget:abc123 npm run acceptance-stage   # test the release candidate container
 *   npm run acceptance-stage                                  # test the working copy (local dev)
 *
 * The same script runs in CI and on a developer's machine.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_PORT = Number(process.env.APP_PORT) || 3000;
const STUB_PORT = Number(process.env.STUB_PORT) || 3999;
const OPERATOR_API_KEY = process.env.OPERATOR_API_KEY || 'acceptance-operator-key';
// Small, so specs can reach a widget's monthly Google allowance quickly.
const GOOGLE_REQUESTS_PER_WIDGET_PER_MONTH = '3';
const IMAGE = process.env.IMAGE;
const CONTAINER = `reputation-widget-acceptance-${process.pid}`;
const BASE_URL = `http://localhost:${APP_PORT}`;

const children = [];
let dataDir;

function start(command, args, env) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = '';
  child.stdout.on('data', (d) => (child.output += d));
  child.stderr.on('data', (d) => (child.output += d));
  children.push(child);
  return child;
}

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function run(script, env) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', '--silent', script], { env: { ...process.env, ...env }, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function deploySystemUnderTest() {
  const appEnv = {
    PORT: String(APP_PORT),
    PUBLIC_URL: BASE_URL,
    GOOGLE_PLACES_API_KEY: 'acceptance-stub-key',
    OPERATOR_API_KEY,
    GOOGLE_REQUESTS_PER_WIDGET_PER_MONTH,
  };

  if (IMAGE) {
    console.log(`Deploying release candidate ${IMAGE}`);
    const envArgs = Object.entries({
      ...appEnv,
      PORT: '3000',
      GOOGLE_PLACES_BASE_URL: `http://host.docker.internal:${STUB_PORT}/v1`,
    }).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    execFileSync('docker', [
      'run', '-d', '--rm', '--name', CONTAINER,
      '-p', `${APP_PORT}:3000`,
      '--add-host', 'host.docker.internal:host-gateway',
      ...envArgs,
      IMAGE,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    return () => execFileSync('docker', ['logs', CONTAINER], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }

  console.log('Deploying working copy (no IMAGE given)');
  dataDir = mkdtempSync(join(tmpdir(), 'rw-acceptance-'));
  const app = start('node', ['src/server.js'], {
    ...appEnv,
    GOOGLE_PLACES_BASE_URL: `http://localhost:${STUB_PORT}/v1`,
    DATA_FILE: join(dataDir, 'db.json'),
  });
  return () => app.output;
}

function teardown() {
  for (const child of children) child.kill();
  if (IMAGE) {
    try {
      execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
    } catch {
      // already gone
    }
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}

async function main() {
  const stub = start('node', ['acceptance/stubs/google-places-stub.js'], { STUB_PORT: String(STUB_PORT) });
  const logs = deploySystemUnderTest();
  const testEnv = {
    BASE_URL,
    GOOGLE_STUB_URL: `http://localhost:${STUB_PORT}`,
    OPERATOR_API_KEY,
    GOOGLE_REQUESTS_PER_WIDGET_PER_MONTH,
  };

  try {
    await waitFor(`http://localhost:${STUB_PORT}/__stub/health`);
    await waitFor(`${BASE_URL}/healthz`);
  } catch (err) {
    console.error(err.message, '\n--- stub ---\n', stub.output, '\n--- app ---\n', logs());
    return 1;
  }

  const smoke = await run('test:smoke', testEnv);
  const acceptance = smoke === 0 ? await run('test:acceptance', testEnv) : 1;
  if (smoke !== 0 || acceptance !== 0) {
    console.error('\n--- system under test logs ---\n' + logs());
    return 1;
  }
  console.log('\nAcceptance stage passed: this release candidate is releasable.');
  return 0;
}

let exitCode = 1;
try {
  exitCode = await main();
} finally {
  teardown();
}
process.exit(exitCode);
