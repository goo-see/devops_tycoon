/** Vite config for the TEST-ONLY event-derived capacity benchmark harness. Serves the
 * repo's `frontend/public` so the REAL production effect PNGs are fetchable at their
 * canonical URLs (real checksums verified by ProductionImageAssetLoader). Separate
 * root/entry from the production app so the harness never enters the production bundle. */
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, '../../../public'),
  server: { port: 5183, strictPort: true, host: '127.0.0.1' },
  preview: { port: 5183, strictPort: true, host: '127.0.0.1' },
});
