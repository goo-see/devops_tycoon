/** Playwright config for the self-contained event-derived effect harness. Spins up
 * its own Vite server (serving frontend/public for the real effect PNG; no backend)
 * and runs the event→effect scenarios against the real controller + AssetManager in
 * real WebGL2. NO simulation backend — events are fed in the delivered envelope shape. */
import { defineConfig } from '@playwright/test';

// ANGLE backend is SwiftShader by default (CI-portable). Set PW_ANGLE=metal to
// validate on the real Apple GPU (ANGLE Metal Renderer) for hardware evidence.
const angle = process.env.PW_ANGLE ?? 'swiftshader';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: ['event-derived-effect.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5182',
    launchOptions: {
      args: [`--use-gl=angle`, `--use-angle=${angle}`, '--enable-webgl', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'vite --config tests/browser/event-derived-effect/vite.config.ts',
    port: 5182,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
