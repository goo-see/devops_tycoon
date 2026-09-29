/**
 * Durable Event-Derived LIVE E2E config (EVENT_DERIVED_LIVE_E2E_AUTOMATION).
 *
 * Expects the real stack to already be running — `launch.mjs` (via
 * `npm run test:browser:event-derived-live`) starts a backend on 127.0.0.1:<dynamic>
 * and a Vite server on 127.0.0.1:<dynamic> proxying to it, then sets E2E_BASE_URL /
 * E2E_API_URL. PW_ANGLE=metal validates on the real Apple GPU locally; CI uses the
 * repository-supported (software) renderer — reported separately, never conflated.
 */
import { defineConfig } from '@playwright/test';

const angle = process.env.PW_ANGLE ?? 'swiftshader';

export default defineConfig({
  testDir: './tests/browser/event-derived-live',
  testMatch: ['*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5199',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [`--use-gl=angle`, `--use-angle=${angle}`, '--enable-webgl', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
