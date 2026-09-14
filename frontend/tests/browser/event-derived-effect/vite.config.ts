/** Vite config for the TEST-ONLY event-derived effect harness. Serves the repo's
 * `frontend/public` so the REAL production effect PNG is fetchable at its canonical URL
 * (checksum verified by ProductionImageAssetLoader). Separate root/entry from the
 * production app so the harness never enters the production bundle. */
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, '../../../public'),
  server: { port: 5182, strictPort: true },
  preview: { port: 5182, strictPort: true },
});
