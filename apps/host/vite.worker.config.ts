import { defineConfig } from 'vite-plus'
import { releaseLicenses } from './scripts/release-licenses'

/*
 * A worker's own release's JavaScript (src/worker.ts): its setup's commands alone, without the home, into
 * `dist/worker/`, beside the home's `dist/althar-host.js`. Its notices are of what this build takes in.
 */
export default defineConfig({
  plugins: [releaseLicenses()],
  build: {
    ssr: 'src/worker.ts',
    outDir: 'dist/worker',
    target: 'node24',
    rollupOptions: { output: { entryFileNames: 'althar-worker.js', banner: '#!/usr/bin/env node' } },
  },
  ssr: { noExternal: true, target: 'node' },
})
