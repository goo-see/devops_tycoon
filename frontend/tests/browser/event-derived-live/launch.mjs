/**
 * Durable launcher for the Event-Derived LIVE E2E harness.
 *
 * One command (`npm run test:browser:event-derived-live`) that:
 *   1. allocates two free 127.0.0.1 ports (backend + frontend),
 *   2. starts the real FastAPI backend (in-memory storage; manual tick API enabled)
 *      bound to 127.0.0.1 — avoiding ambiguous localhost IPv4/IPv6 resolution,
 *   3. starts a Vite server (real app) whose proxy targets the exact backend port,
 *   4. waits (bounded, polled) for both to be ready — no arbitrary sleeps,
 *   5. runs the Playwright live specs against those exact URLs,
 *   6. tears down every child process it started (success / failure / timeout / SIGINT),
 *      leaving no orphan server or occupied port. It never kills unrelated processes.
 *
 * Extra CLI args are forwarded to `playwright test` (e.g. `--repeat-each=10`).
 * Backend interpreter: $E2E_PYTHON, else repo `.venv-ops-rv3/bin/python`, else `python3`.
 * The live path uses only in-memory simulation state — PostgreSQL/Redis are NOT required.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(here, '../../..');
const repoRoot = resolve(frontendDir, '..');
const logDir = resolve(frontendDir, 'test-results/event-derived-live');
mkdirSync(logDir, { recursive: true });

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

function pythonBin() {
  if (process.env.E2E_PYTHON) return process.env.E2E_PYTHON;
  const venv = resolve(repoRoot, '.venv-ops-rv3/bin/python');
  return existsSync(venv) ? venv : 'python3';
}

async function waitReady(url, label, timeoutMs = 60_000) {
  const start = Date.now();
  let lastErr = 'none';
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
      lastErr = `HTTP ${r.status}`;
    } catch (e) {
      lastErr = String(e?.message ?? e);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`readiness timeout for ${label} (${url}): ${lastErr}`);
}

const children = [];
function start(cmd, args, opts) {
  const child = spawn(cmd, args, { detached: true, ...opts });
  children.push(child);
  return child;
}
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const c of children) {
    if (c.pid && c.exitCode === null) {
      try { process.kill(-c.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
  }
  // Escalate after a short grace period.
  setTimeout(() => {
    for (const c of children) {
      if (c.pid && c.exitCode === null) {
        try { process.kill(-c.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
  }, 2500).unref();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error('[launch] uncaught:', e); cleanup(); process.exit(1); });

const backendLog = createWriteStream(resolve(logDir, 'backend.log'));
const viteLog = createWriteStream(resolve(logDir, 'vite.log'));

async function main() {
  const [bport, fport] = [await freePort(), await freePort()];
  const backendUrl = `http://127.0.0.1:${bport}`;
  const frontendUrl = `http://127.0.0.1:${fport}`;
  const py = pythonBin();
  console.log(`[launch] python=${py}  backend=${backendUrl}  frontend=${frontendUrl}`);

  const backend = start(py, ['-m', 'uvicorn', 'backend.app:create_app', '--factory', '--host', '127.0.0.1', '--port', String(bport)], {
    cwd: repoRoot,
    env: { ...process.env, DEVOPS_TYCOON_ENABLE_MANUAL_TICK_API: 'true', DEVOPS_TYCOON_MAX_TICKS_PER_REQUEST: '100' },
  });
  backend.stdout.pipe(backendLog); backend.stderr.pipe(backendLog);

  const vite = start('npx', ['vite', '--config', 'tests/browser/event-derived-live/vite.config.ts'], {
    cwd: frontendDir,
    env: { ...process.env, E2E_BACKEND_URL: backendUrl, E2E_FRONTEND_PORT: String(fport) },
  });
  vite.stdout.pipe(viteLog); vite.stderr.pipe(viteLog);

  await waitReady(`${backendUrl}/health/live`, 'backend');
  await waitReady(`${frontendUrl}/`, 'frontend');
  console.log('[launch] stack ready — running Playwright');

  const extra = process.argv.slice(2);
  const pw = spawn('npx', ['playwright', 'test', '-c', 'playwright.event-derived-live.config.ts', ...extra], {
    cwd: frontendDir,
    env: { ...process.env, E2E_BASE_URL: frontendUrl, E2E_API_URL: backendUrl },
    stdio: 'inherit',
  });
  const code = await new Promise((res) => pw.on('exit', (c) => res(c ?? 1)));
  cleanup();
  process.exit(code);
}

main().catch((e) => { console.error('[launch] failed:', e.message); console.error(`[launch] see ${logDir}/backend.log and vite.log`); cleanup(); process.exit(1); });
