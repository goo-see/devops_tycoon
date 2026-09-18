/**
 * Committed dev-server config for the durable Event-Derived LIVE E2E harness
 * (EVENT_DERIVED_LIVE_E2E_AUTOMATION). Serves the REAL production app (same root/entry
 * as the main app) so the browser exercises the real AppProviders + AssetManager +
 * ProductionImageAssetLoader — no fixture, no mock, no data URL.
 *
 * Unlike the committed product `vite.config.ts` (whose dev proxy targets a fixed
 * localhost:8000), this harness reads the backend URL + frontend port from the
 * environment set by `launch.mjs`, and binds to 127.0.0.1 to avoid ambiguous
 * localhost IPv4/IPv6 resolution (§14). Test-only; never part of the production bundle.
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '../../..'); // frontend/

const backend = process.env.E2E_BACKEND_URL ?? 'http://127.0.0.1:8000';
const wsBackend = backend.replace(/^http/, 'ws');
const port = Number(process.env.E2E_FRONTEND_PORT ?? '5199');

export default defineConfig({
  root: frontendRoot,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/internal': { target: backend, changeOrigin: true },
      '/ws': { target: wsBackend, ws: true },
    },
  },
});
