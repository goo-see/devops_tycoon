/** EVENT_DERIVED_RUNTIME_CAPACITY_BASELINE harness config (test-only). Spins up its own
 * Vite server (serving frontend/public for the REAL production effect PNGs) and drives
 * the benchmark in real WebGL2. Fixed viewport + DPR for reproducibility.
 *
 * PW_ANGLE=metal → real Apple GPU (the capacity source of truth). Default swiftshader is
 * for CI harness SMOKE only — its numbers are NOT the performance baseline.
 * --enable-precise-memory-info + --js-flags=--expose-gc enable JS heap observation. */
import { defineConfig } from '@playwright/test';

const angle = process.env.PW_ANGLE ?? 'swiftshader';

export default defineConfig({
  testDir: './tests/browser/event-derived-capacity',
  testMatch: ['capacity.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 900_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5183',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [
        `--use-gl=angle`, `--use-angle=${angle}`, '--enable-webgl', '--ignore-gpu-blocklist',
        '--enable-precise-memory-info', '--js-flags=--expose-gc',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'vite --config tests/browser/event-derived-capacity/vite.config.ts',
    port: 5183,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
