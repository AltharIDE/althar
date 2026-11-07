import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real kit and the real project header in a browser. The
 * prototype reaches across to the desktop app only for its app.css, and asks
 * for nothing of the runtime: the five repositories and their hosts are in
 * data.ts.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')

export default defineConfig({
  root: here,
  plugins: [react()],
  dedupe: ['react', 'react-dom'],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // Polling, so a server started inside the sandbox still sees edits.
  server: { port: 5358, strictPort: true, fs: { allow: [repo] }, watch: { usePolling: true, interval: 1000 } },
})
